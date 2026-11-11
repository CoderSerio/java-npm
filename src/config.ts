import { errorCode } from './validation.js';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

function javaVersion(value: unknown, source: string) {
  if (!/^\d{2}$/.test(String(value)) || Number(value) < 17) {
    throw new Error(`${source}: java must be a major version from 17 to 99, such as java=21.`);
  }
  return String(value);
}

export function parseJpmrc(text: string, filename = '.jpmrc') {
  const result: { java?: string } = {};
  for (const [index, line] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const content = line.replace(/[#;].*$/, '').trim();
    if (!content) continue;
    const match = /^([^=\s]+)\s*=\s*(.*?)\s*$/.exec(content);
    const source = `${filename}:${index + 1}`;
    if (!match) throw new Error(`${source}: expected java=<major>; sections and interpolation are not supported.`);
    const [, key, value] = match;
    if (key !== 'java') throw new Error(`${source}: unsupported setting ${key}; only java is supported.`);
    if (Object.hasOwn(result, key)) throw new Error(`${source}: duplicate java setting.`);
    result.java = javaVersion(value, source);
  }
  return result;
}

async function fileInfo(file: string) {
  try { return await lstat(file); }
  catch (error) { if (errorCode(error) === 'ENOENT') return undefined; throw error; }
}

async function directories(cwd: string, homeDir: string) {
  return {
    cwd: await realpath(cwd),
    homeDir: await realpath(homeDir).catch(error => { if (errorCode(error) === 'ENOENT') return path.resolve(homeDir); throw error; }),
  };
}

async function findProjectFile(cwd: string, homeDir: string, forWrite = false) {
  for (let directory = cwd; directory !== homeDir; directory = path.dirname(directory)) {
    const file = path.join(directory, '.jpmrc');
    if (await fileInfo(file)) return file;
    // A package or repository root owns its selection; never inherit an outer workspace's rc.
    if (await fileInfo(path.join(directory, 'package.json')) || await fileInfo(path.join(directory, '.git'))) return forWrite ? file : undefined;
    if (path.dirname(directory) === directory) break;
  }
  return undefined;
}

export async function readJavaConfig(cwd: string, { homeDir = homedir(), fallbackVersion }: { homeDir?: string; fallbackVersion?: string | number } = {}) {
  const locations = await directories(cwd, homeDir);
  const projectFile = await findProjectFile(locations.cwd, locations.homeDir);
  const userFile = path.join(locations.homeDir, '.jpmrc');
  const project = projectFile ? parseJpmrc(await readFile(projectFile, 'utf8'), projectFile) : {};
  const user = await fileInfo(userFile) ? parseJpmrc(await readFile(userFile, 'utf8'), userFile) : {};
  const fallback = fallbackVersion === undefined ? undefined : javaVersion(fallbackVersion, 'package.json');
  if (project.java !== undefined) return { version: project.java, source: projectFile, projectFile };
  if (fallback !== undefined) return { version: fallback, source: 'package.json', projectFile };
  return { version: user.java, source: user.java === undefined ? undefined : userFile, projectFile };
}

export async function writeJavaConfig(cwd: string, version: string | number, { global = false, homeDir = homedir() } = {}) {
  const major = javaVersion(version, '.jpmrc');
  const locations = await directories(cwd, homeDir);
  if (!global && locations.cwd === locations.homeDir) {
    throw new Error('Use --global to write ~/.jpmrc; a local selection must be made from a project directory.');
  }
  const file = global ? path.join(locations.homeDir, '.jpmrc')
    : await findProjectFile(locations.cwd, locations.homeDir, true) ?? path.join(locations.cwd, '.jpmrc');
  const info = await fileInfo(file);
  if (info?.isSymbolicLink()) throw new Error(`Refusing to overwrite a symlinked config: ${file}`);
  const previous = info ? await readFile(file, 'utf8') : '';
  const config = parseJpmrc(previous, file);
  const newline = previous.includes('\r\n') ? '\r\n' : '\n';
  const contents = config.java === undefined
    ? `${previous}${previous && !previous.endsWith('\n') ? newline : ''}java=${major}${newline}`
    : previous.replace(/^([\t \uFEFF]*java[\t ]*=[\t ]*)\d{2}([^\r\n]*)/m, (_match, prefix, suffix) => `${prefix}${major}${suffix}`);
  if (contents === previous) return file;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: info ? info.mode & 0o777 : 0o600 });
    if (info) await chmod(temporary, info.mode & 0o777);
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
  }
  return file;
}
