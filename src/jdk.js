import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { x as extract } from 'tar';

const execute = promisify(execFile);
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

function majorVersion(version) {
  if (!/^[1-9]\d*$/.test(String(version)) || !Number.isSafeInteger(Number(version)) || Number(version) < 17) {
    throw new Error('Java version must be a major version of 17 or newer, such as 21.');
  }
  return Number(version);
}

function settings(options) {
  const platform = options.platform ?? process.platform;
  if (!['darwin', 'linux'].includes(platform)) {
    throw new Error('jpm 0.1 supports JDK management on macOS and Linux. Windows support is not available yet.');
  }
  const homeDir = options.homeDir ?? homedir();
  return { platform, homeDir, env: options.env ?? process.env, cacheRoot: options.cacheRoot ?? path.join(homeDir, '.jpm', 'jdks') };
}

async function output(command, args, env) {
  const result = await execute(command, args, { env, timeout: 10_000, maxBuffer: 1024 * 1024 });
  return `${result.stdout}\n${result.stderr}`;
}

function selectedEnvironment(home, env) {
  const bin = path.join(home, 'bin');
  const previousBin = env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin');
  const remaining = (env.PATH ? env.PATH.split(path.delimiter) : []).filter(entry => {
    const normalized = entry && path.normalize(entry);
    return normalized !== bin && normalized !== previousBin;
  });
  return { ...env, JAVA_HOME: home, PATH: [bin, ...remaining].join(path.delimiter) };
}

export function shellEnvironment(jdk, env = process.env) {
  if (typeof jdk?.home !== 'string' || !path.isAbsolute(jdk.home) || jdk.home.includes('\0') || jdk.home.includes(path.delimiter)) {
    throw new Error('The JDK home must be an absolute path without a NUL or PATH separator.');
  }
  const selected = selectedEnvironment(jdk.home, env);
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  return `export JAVA_HOME=${quote(selected.JAVA_HOME)};\nexport PATH=${quote(selected.PATH)};\n`;
}

async function inspectHome(candidate, version, env) {
  for (const home of [candidate, path.join(candidate, 'Contents', 'Home')]) {
    try {
      const java = await output(path.join(home, 'bin', 'java'), ['-XshowSettings:properties', '-version'], env);
      const javaVersion = java.match(/^\s*java\.specification\.version\s*=\s*(\d+)\s*$/m)?.[1]
        ?? java.match(/\bversion\s+"(?:1\.)?(\d+)/)?.[1];
      const detectedVersion = Number(javaVersion);
      if (!Number.isSafeInteger(detectedVersion) || detectedVersion < 17 || (version !== undefined && detectedVersion !== version)) continue;
      const javac = await output(path.join(home, 'bin', 'javac'), ['-version'], env);
      if (Number(javac.match(/\bjavac\s+(?:1\.)?(\d+)/)?.[1]) !== detectedVersion) continue;
      const resolvedHome = await realpath(home);
      return { home: resolvedHome, version: detectedVersion, env: selectedEnvironment(resolvedHome, env) };
    } catch {
      // A candidate may be missing, a JRE, or an incompatible installation.
    }
  }
  return null;
}

async function candidateHomes(options, major) {
  const { platform, homeDir, env, cacheRoot } = settings(options);
  const candidates = [env.JAVA_HOME];
  if (major !== undefined) candidates.push(path.join(cacheRoot, String(major)));
  const sdkman = path.join(env.SDKMAN_CANDIDATES_DIR ?? path.join(homeDir, '.sdkman', 'candidates'), 'java');
  const directories = [sdkman, ...(platform === 'darwin'
    ? ['/Library/Java/JavaVirtualMachines', path.join(homeDir, 'Library', 'Java', 'JavaVirtualMachines'), '/System/Library/Java/JavaVirtualMachines']
    : ['/usr/lib/jvm'])];
  if (major === undefined) directories.unshift(cacheRoot);
  for (const directory of directories) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      candidates.push(...entries.filter(entry => (entry.isDirectory() || entry.isSymbolicLink())
        && (directory !== cacheRoot || /^\d+$/.test(entry.name))).map(entry => path.join(directory, entry.name)));
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  if (platform === 'darwin') {
    try { candidates.push((await output('/usr/libexec/java_home', major === undefined ? [] : ['-v', String(major)], env)).trim()); } catch {}
  }
  try {
    const java = await output('java', ['-XshowSettings:properties', '-version'], env);
    candidates.push(java.match(/^\s*java\.home\s*=\s*(.+)$/m)?.[1].trim());
  } catch {}
  return { candidates: [...new Set(candidates.filter(Boolean))], env };
}

export async function listJdks(options = {}) {
  const { candidates, env } = await candidateHomes(options);
  const installed = new Map();
  for (const candidate of candidates) {
    const result = await inspectHome(candidate, undefined, env);
    if (result) installed.set(result.home, result);
  }
  return [...installed.values()].sort((a, b) => a.version - b.version || a.home.localeCompare(b.home));
}

export async function resolveJdk(version, options = {}) {
  const major = majorVersion(version);
  const { env } = settings(options);
  if (env.JAVA_HOME) {
    const configured = await inspectHome(env.JAVA_HOME, major, env);
    if (configured) return configured;
  }
  const { candidates } = await candidateHomes(options, major);
  for (const candidate of candidates) {
    if (candidate === env.JAVA_HOME) continue;
    const result = await inspectHome(candidate, major, env);
    if (result) return result;
  }
  throw new Error(`JDK ${major} was not found. Run "jpm jdk install ${major}", or set JAVA_HOME to a JDK ${major} installation (including javac).`);
}

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readResponse(response, limit) {
  if (!response.ok) throw new Error(`JDK download failed: HTTP ${response.status}.`);
  if (!response.body) throw new Error('JDK download returned an empty response.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('JDK metadata exceeded the size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function installJdk(version, options = {}) {
  const major = majorVersion(version);
  const { platform, env, cacheRoot } = settings(options);
  const architecture = { x64: 'x64', arm64: 'aarch64' }[options.arch ?? process.arch];
  if (!architecture) throw new Error('JDK installation supports x64 and arm64 processors.');
  const destination = path.join(cacheRoot, String(major));
  if (await exists(destination)) {
    const installed = await inspectHome(destination, major, env);
    if (installed) return installed;
    throw new Error(`The existing JDK directory is incomplete or incompatible: ${destination}. Move it aside before retrying; jpm will not overwrite it.`);
  }

  await mkdir(cacheRoot, { recursive: true });
  const lock = `${destination}.lock`;
  try { await mkdir(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`JDK ${major} installation is already in progress. If no installer is running, remove the stale lock directory: ${lock}`);
    throw error;
  }
  let staging;
  try {
    staging = await mkdtemp(path.join(cacheRoot, '.install-'));
    const request = options.fetch ?? globalThis.fetch;
    const query = new URLSearchParams({ architecture, image_type: 'jdk', os: platform === 'darwin' ? 'mac' : 'linux', vendor: 'eclipse', project: 'jdk' });
    const response = await request(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?${query}`, { signal: AbortSignal.timeout(30_000) });
    const assets = JSON.parse(await readResponse(response, 2 * 1024 * 1024));
    const asset = Array.isArray(assets) ? assets.find(item => item.version?.major === major && item.binary?.package) : null;
    const archive = asset?.binary?.package;
    if (!archive || !/^[a-f\d]{64}$/i.test(archive.checksum ?? '') || !Number.isSafeInteger(archive.size) || archive.size <= 0 || archive.size > MAX_ARCHIVE_BYTES) {
      throw new Error(`Adoptium did not return a valid JDK ${major} archive for this platform.`);
    }
    const url = new URL(archive.link);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/adoptium/')) {
      throw new Error('Adoptium returned an unexpected JDK download URL.');
    }
    const download = await request(url, { signal: AbortSignal.timeout(300_000) });
    if (!download.ok || !download.body) throw new Error(`JDK download failed: HTTP ${download.status}.`);
    if (download.url && new URL(download.url).protocol !== 'https:') throw new Error('JDK download redirected to an insecure URL.');
    const archivePath = path.join(staging, 'jdk.tar.gz');
    const hash = createHash('sha256');
    let bytes = 0;
    await pipeline(Readable.fromWeb(download.body), new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > archive.size || bytes > MAX_ARCHIVE_BYTES) return callback(new Error('JDK archive exceeded its expected size.'));
        hash.update(chunk);
        callback(null, chunk);
      },
    }), createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
    if (bytes !== archive.size || hash.digest('hex') !== archive.checksum.toLowerCase()) {
      throw new Error('JDK archive checksum or size verification failed. Nothing was installed.');
    }
    const unpacked = path.join(staging, 'unpacked');
    await mkdir(unpacked);
    let extractedBytes = 0;
    let unsafeArchive = false;
    await extract({ file: archivePath, cwd: unpacked, strict: true, preserveOwner: false, chmod: true,
      filter(entryPath, entry) {
        extractedBytes += entry.size;
        const link = entry.type === 'SymbolicLink' ? path.posix.join(path.posix.dirname(entryPath), entry.linkpath) : entry.linkpath;
        if (entryPath.includes('\\') || path.posix.isAbsolute(entryPath) || entryPath.split('/').includes('..')
          || !['File', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)
          || (link && (path.posix.isAbsolute(entry.linkpath) || link.includes('\\') || path.posix.normalize(link).split('/').includes('..')
            || path.posix.normalize(link).split('/')[0] !== path.posix.normalize(entryPath).split('/')[0]))
          || extractedBytes > 2 * 1024 * 1024 * 1024) {
          unsafeArchive = true;
          return false;
        }
        return true;
      },
    });
    if (unsafeArchive) throw new Error('JDK archive contains an unsafe path, entry type, or excessive expanded data.');
    const entries = await readdir(unpacked, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) throw new Error('JDK archive has an unexpected directory structure.');
    const extractedRoot = path.join(unpacked, entries[0].name);
    if (!await inspectHome(extractedRoot, major, env)) throw new Error('Downloaded JDK failed the java/javac version checks. Nothing was installed.');
    if (await exists(destination)) throw new Error(`JDK installation directory appeared during download: ${destination}. Nothing was overwritten.`);
    await rename(extractedRoot, destination);
    const installed = await inspectHome(destination, major, env);
    if (!installed) throw new Error(`JDK installation could not be verified at ${destination}.`);
    return installed;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
