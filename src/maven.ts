import { errorCode } from './validation.js';
import { spawn, type StdioOptions } from 'node:child_process';
import { access, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { constants as osConstants } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

interface MavenOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  signal?: AbortSignal;
  args?: string[];
}

const signalCode = (signal: NodeJS.Signals | null) => signal && osConstants.signals[signal] ? 128 + osConstants.signals[signal] : 1;

export async function wrapperPath(cwd: string) {
  if (process.platform === 'win32') throw new Error('jpm currently supports macOS and Linux. Use WSL on Windows.');
  const wrapper = path.join(cwd, 'mvnw');
  try {
    if (!(await stat(wrapper)).isFile()) throw new Error('not a file');
    await access(wrapper, constants.X_OK);
  }
  catch { throw new Error('Maven Wrapper is missing or not executable. Run this command in a jpm project containing ./mvnw.'); }
  return wrapper;
}

function spawnMaven(wrapper: string, cwd: string, args: string[], options: MavenOptions) {
  const child = spawn(wrapper, args, {
    cwd, env: options.env ?? process.env, stdio: options.stdio ?? 'inherit', detached: true,
  });
  let requestedSignal: NodeJS.Signals | undefined;
  let forceTimer: NodeJS.Timeout | undefined;
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) {
      if (errorCode(error) === 'ESRCH') return;
      if (errorCode(error) === 'EPERM' && (child.exitCode !== null || child.signalCode !== null)) return;
      throw error;
    }
  };
  const alive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if (errorCode(error) === 'ESRCH') return false;
      if (errorCode(error) === 'EPERM' && (child.exitCode !== null || child.signalCode !== null)) return false;
      throw error;
    }
  };
  const done = new Promise<number>((resolve, reject) => {
    child.once('error', (error) => { clearTimeout(forceTimer); reject(error); });
    child.once('close', async (code, signal) => {
      clearTimeout(forceTimer);
      try {
        // Maven can fork a Spring process; reap the whole group before returning.
        if (alive()) {
          kill(requestedSignal ?? 'SIGTERM');
          const deadline = Date.now() + 2000;
          while (alive() && Date.now() < deadline) await delay(50);
          if (alive()) kill('SIGKILL');
        }
        resolve(requestedSignal ? signalCode(requestedSignal) : code ?? signalCode(signal));
      } catch (error) { reject(error); }
    });
  });
  return { done, stop(signal: NodeJS.Signals = 'SIGTERM') {
    requestedSignal ??= signal;
    kill(signal);
    forceTimer ??= setTimeout(() => kill('SIGKILL'), 2000);
  } };
}

function listenForStop(stop: (signal: NodeJS.Signals) => void, signal?: AbortSignal) {
  const onInt = () => stop('SIGINT');
  const onTerm = () => stop('SIGTERM');
  const onAbort = () => stop('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return () => {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    signal?.removeEventListener('abort', onAbort);
  };
}

export async function runMaven(cwd: string, args: string[], options: MavenOptions = {}) {
  const wrapper = await wrapperPath(cwd);
  if (options.signal?.aborted) return 143;
  const job = spawnMaven(wrapper, cwd, args, options);
  const unlisten = listenForStop((signal) => job.stop(signal), options.signal);
  try { return await job.done; }
  finally { unlisten(); }
}

async function sourceSnapshot(root: string): Promise<Map<string, string>> {
  let entries;
  try { entries = await readdir(root, { recursive: true, withFileTypes: true }); }
  catch (error) { if (errorCode(error) === 'ENOENT') return new Map(); throw error; }
  const snapshot = new Map<string, string>();
  await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (!relative.endsWith('.java') && !relative.startsWith('resources/')) return;
    try {
      const info = await stat(file, { bigint: true });
      snapshot.set(relative, `${info.mtimeNs}:${info.size}`);
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
  }));
  return snapshot;
}

export async function runDev(cwd: string, options: MavenOptions = {}) {
  const wrapper = await wrapperPath(cwd);
  if (options.signal?.aborted) return 143;
  const sources = path.join(cwd, 'src', 'main');
  try { await access(sources); }
  catch { throw new Error('Cannot watch this project: src/main is missing.'); }
  const classes = path.join(cwd, 'target', 'classes');
  const backup = path.join(cwd, 'target', '.jpm-classes-backup');
  const trigger = path.join(classes, '.jpm-reload');
  await mkdir(classes, { recursive: true });
  await writeFile(trigger, 'jpm dev started\n');

  const jobs = new Set<ReturnType<typeof spawnMaven>>();
  const start = (args: string[]) => {
    const job = spawnMaven(wrapper, cwd, args, {
      ...options, env: { ...(options.env ?? process.env), SPRING_DEVTOOLS_RESTART_TRIGGER_FILE: '.jpm-reload' },
    });
    jobs.add(job);
    job.done.then(() => jobs.delete(job), () => jobs.delete(job));
    return job;
  };
  let stopped = false;
  let dirty = false;
  let clean = false;
  let timer: NodeJS.Timeout | undefined;
  let compiling: Promise<void> | undefined;
  let fatalError: unknown;
  let poller: NodeJS.Timeout | undefined;
  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(poller);
    for (const job of jobs) job.stop(signal);
  };
  const compile = async () => {
    while (dirty && !stopped) {
      dirty = false;
      const needsClean = clean;
      clean = false;
      if (needsClean) {
        // Renames/deletions must not leave removed classes or resources in the build.
        await rm(backup, { recursive: true, force: true });
        await cp(classes, backup, { recursive: true, preserveTimestamps: true });
        await rm(classes, { recursive: true, force: true });
        await mkdir(classes, { recursive: true });
        await cp(path.join(backup, '.jpm-reload'), trigger, { preserveTimestamps: true });
      }
      const code = await start(['compile', ...(options.args ?? [])]).done;
      if (needsClean && code !== 0) {
        clean = true;
        await rm(classes, { recursive: true, force: true });
        await cp(backup, classes, { recursive: true, preserveTimestamps: true });
      }
      if (needsClean) await rm(backup, { recursive: true, force: true });
      if (stopped) break;
      if (code === 0) {
        await writeFile(trigger, `${Date.now()}\n`);
      } else {
        console.error('jpm: compilation failed; fix the source and save again to retry.');
      }
    }
  };
  const schedule = (needsClean: boolean) => {
    if (stopped) return;
    dirty = true;
    clean ||= needsClean;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (compiling || stopped) return;
      compiling = compile().catch((error) => { fatalError = error; stop(); }).finally(() => { compiling = undefined; });
    }, 200);
  };
  let previous = await sourceSnapshot(sources);
  let polling = false;
  // Polling is portable and handles atomic editor saves without native watcher limits.
  poller = setInterval(async () => {
    if (polling || stopped) return;
    polling = true;
    try {
      const next = await sourceSnapshot(sources);
      const removed = [...previous.keys()].some((file) => !next.has(file));
      const added = [...next.keys()].some((file) => !previous.has(file));
      const changed = [...next].some(([file, value]) => previous.get(file) !== value);
      if (removed || changed) schedule(removed || added);
      previous = next;
    } catch (error) { fatalError = error; stop(); }
    finally { polling = false; }
  }, 300);
  const app = start(['spring-boot:run', ...(options.args ?? [])]);
  const unlisten = listenForStop(stop, options.signal);
  try {
    const code = await app.done;
    if (fatalError) throw fatalError;
    return code;
  } finally {
    stop();
    unlisten();
    await Promise.allSettled([...jobs].map((job) => job.done));
    await compiling;
  }
}
