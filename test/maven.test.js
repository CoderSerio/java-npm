import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runMaven, runDev } from '../src/maven.js';

async function fixture(t, body) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-maven-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'mvnw'), `#!/usr/bin/env node\n${body}`, { mode: 0o755 });
  return cwd;
}

async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error('Timed out waiting for fake Maven');
}

async function events(cwd) {
  try { return (await readFile(path.join(cwd, 'events'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

test('runs wrapper with literal arguments, environment, and exit code', async (t) => {
  const cwd = await fixture(t, `
const fs = require('node:fs');
fs.writeFileSync('args.json', JSON.stringify({ args: process.argv.slice(2), marker: process.env.JPM_TEST_MARKER }));
process.exitCode = 7;
`);
  const code = await runMaven(cwd, ['test', '-Dvalue=a; echo nope', 'two words'], {
    env: { ...process.env, JPM_TEST_MARKER: 'selected-jdk' }, stdio: 'ignore',
  });
  assert.equal(code, 7);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'args.json'), 'utf8')), {
    args: ['test', '-Dvalue=a; echo nope', 'two words'], marker: 'selected-jdk',
  });
});

test('returns the conventional exit code when the wrapper is killed', async (t) => {
  const cwd = await fixture(t, "process.kill(process.pid, 'SIGKILL');\n");
  assert.equal(await runMaven(cwd, ['test'], { stdio: 'ignore' }), 137);
});

test('missing Maven Wrapper has an actionable error', async () => {
  await assert.rejects(runMaven('/does-not-exist', ['test']), /Maven Wrapper is missing/);
});

test('cancellation terminates the wrapper and its forked children', async (t) => {
  const cwd = await fixture(t, `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
fs.writeFileSync('child.pid', String(child.pid));
setInterval(() => {}, 1000);
`);
  const controller = new AbortController();
  const running = runMaven(cwd, ['test'], { stdio: 'ignore', signal: controller.signal });
  t.after(() => controller.abort());
  let pid;
  await until(async () => {
    try { pid = Number(await readFile(path.join(cwd, 'child.pid'), 'utf8')); return true; }
    catch { return false; }
  });
  controller.abort();
  assert.equal(await running, 143);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('dev recompiles serially, queues edits, and removes stale deleted outputs', async (t) => {
  const cwd = await fixture(t, `
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = (event) => fs.appendFileSync('events', JSON.stringify(event) + '\\n');
if (args[0] === 'spring-boot:run') {
  log({ event: 'app', trigger: process.env.SPRING_DEVTOOLS_RESTART_TRIGGER_FILE, args });
  setInterval(() => {}, 1000);
} else {
  log({ event: 'compile-start', args });
  setTimeout(() => {
    fs.mkdirSync('target/classes', { recursive: true });
    fs.writeFileSync('target/classes/Current.class', 'compiled');
    log({ event: 'compile-end' });
  }, 350);
}
`);
  const source = path.join(cwd, 'src/main/java');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'App.java'), 'first');
  const controller = new AbortController();
  t.after(() => controller.abort());
  const mavenArgs = ['-Pdev', '-s', 'settings with spaces.xml', '-Dtest=value'];
  const running = runDev(cwd, { stdio: 'ignore', signal: controller.signal, args: mavenArgs });
  await until(async () => (await events(cwd)).some((e) => e.event === 'app'));
  await writeFile(path.join(source, 'App.java'), 'second');
  await until(async () => (await events(cwd)).some((e) => e.event === 'compile-start'));
  await writeFile(path.join(source, 'App.java'), 'third');
  await until(async () => (await events(cwd)).filter((e) => e.event === 'compile-end').length === 2);
  await writeFile(path.join(cwd, 'target/classes/Stale.class'), 'stale');
  await rm(path.join(source, 'App.java'));
  await until(async () => (await events(cwd)).filter((e) => e.event === 'compile-end').length === 3);
  await assert.rejects(readFile(path.join(cwd, 'target/classes/Stale.class')), { code: 'ENOENT' });
  assert.match(await readFile(path.join(cwd, 'target/classes/.jpm-reload'), 'utf8'), /^\d+\n$/);
  controller.abort();
  assert.equal(await running, 143);
  const recorded = await events(cwd);
  assert.deepEqual(recorded[0], { event: 'app', trigger: '.jpm-reload', args: ['spring-boot:run', ...mavenArgs] });
  for (const event of recorded.filter((e) => e.event === 'compile-start')) {
    assert.deepEqual(event.args, ['compile', ...mavenArgs]);
  }
  assert.deepEqual(recorded.slice(1).map((e) => e.event), [
    'compile-start', 'compile-end', 'compile-start', 'compile-end', 'compile-start', 'compile-end',
  ]);
});

test('failed clean recompilation preserves outputs and cleans again on the next save', async (t) => {
  const cwd = await fixture(t, `
const fs = require('node:fs');
if (process.argv[2] === 'spring-boot:run') {
  fs.writeFileSync('ready', 'yes');
  setInterval(() => {}, 1000);
} else {
  const source = fs.readFileSync('src/main/java/App.java', 'utf8');
  fs.appendFileSync('events', JSON.stringify({ source }) + '\\n');
  process.exitCode = source === 'broken' ? 1 : 0;
}
`);
  const source = path.join(cwd, 'src/main/java/App.java');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, 'good');
  const removedSource = path.join(path.dirname(source), 'Removed.java');
  await writeFile(removedSource, 'removed');
  const controller = new AbortController();
  t.after(() => controller.abort());
  const running = runDev(cwd, { stdio: 'ignore', signal: controller.signal });
  await until(async () => {
    try { return await readFile(path.join(cwd, 'ready'), 'utf8'); }
    catch { return false; }
  });
  const trigger = path.join(cwd, 'target/classes/.jpm-reload');
  const original = await readFile(trigger, 'utf8');
  const staleClass = path.join(cwd, 'target/classes/Removed.class');
  await writeFile(staleClass, 'previous output');
  await rm(removedSource);
  await writeFile(source, 'broken');
  await until(async () => (await events(cwd)).length === 1);
  await until(async () => {
    try { return await readFile(staleClass, 'utf8') === 'previous output' && await readFile(trigger, 'utf8') === original; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  assert.equal(await readFile(trigger, 'utf8'), original);
  await writeFile(source, 'fixed');
  await until(async () => {
    try { return /^\d+\n$/.test(await readFile(trigger, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  await assert.rejects(readFile(staleClass), { code: 'ENOENT' });
  controller.abort();
  assert.equal(await running, 143);
  assert.deepEqual(await events(cwd), [{ source: 'broken' }, { source: 'fixed' }]);
});
