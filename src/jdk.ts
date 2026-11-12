import { errorCode, isRecord } from './validation.js';
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

export interface Jdk {
  home: string;
  version: number;
  runtimeVersion?: string;
  distribution?: 'temurin';
  architecture?: 'x64' | 'aarch64';
  env: NodeJS.ProcessEnv;
}
export interface RemoteJdk {
  version: number;
  runtimeVersion: string;
  distribution: 'temurin';
  architecture: 'x64' | 'aarch64';
}
interface JdkOptions {
  platform?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  cacheRoot?: string;
  arch?: string;
  /** Override OS installation roots for isolated discovery (defaults to platform paths). */
  systemRoots?: readonly string[];
  fetch?: typeof globalThis.fetch;
  installIfMissing?: boolean;
  onInstall?: () => void;
}

const execute = promisify(execFile);
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export function majorVersion(version: unknown) {
  if (!/^\d{2}$/.test(String(version)) || Number(version) < 17) {
    throw new Error('Java version must be a major version from 17 to 99, such as 21.');
  }
  return Number(version);
}

function settings(options: JdkOptions) {
  const platform = options.platform ?? process.platform;
  if (!['darwin', 'linux'].includes(platform)) {
    throw new Error('jpm 0.1 supports JDK management on macOS and Linux. Windows support is not available yet.');
  }
  const homeDir = options.homeDir ?? homedir();
  return { platform, homeDir, env: options.env ?? process.env, cacheRoot: options.cacheRoot ?? path.join(homeDir, '.jpm', 'jdks') };
}

async function output(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 10_000) {
  const result = await execute(command, args, { env, timeout, maxBuffer: 1024 * 1024 });
  return `${result.stdout}\n${result.stderr}`;
}

function selectedEnvironment(home: string, env: NodeJS.ProcessEnv) {
  const bin = path.join(home, 'bin');
  const previousBin = env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin');
  const remaining = (env.PATH ? env.PATH.split(path.delimiter) : []).filter(entry => {
    const normalized = entry && path.normalize(entry);
    return normalized !== bin && normalized !== previousBin;
  });
  return { ...env, JAVA_HOME: home, PATH: [bin, ...remaining].join(path.delimiter) };
}

export function shellEnvironment(jdk: Pick<Jdk, 'home'>, env = process.env) {
  if (typeof jdk?.home !== 'string' || !path.isAbsolute(jdk.home) || jdk.home.includes('\0') || jdk.home.includes(path.delimiter)) {
    throw new Error('The JDK home must be an absolute path without a NUL or PATH separator.');
  }
  const selected = selectedEnvironment(jdk.home, env);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `export JAVA_HOME=${quote(selected.JAVA_HOME)};\nexport PATH=${quote(selected.PATH)};\n`;
}

async function inspectHome(candidate: string, version: number | undefined, env: NodeJS.ProcessEnv, timeout = 10_000): Promise<Jdk | null> {
  for (const home of [candidate, path.join(candidate, 'Contents', 'Home')]) {
    try {
      const java = await output(path.join(home, 'bin', 'java'), ['-XshowSettings:properties', '-version'], env, timeout);
      const javaVersion = java.match(/^\s*java\.specification\.version\s*=\s*(\d+)\s*$/m)?.[1]
        ?? java.match(/\bversion\s+"(?:1\.)?(\d+)/)?.[1];
      const detectedVersion = Number(javaVersion);
      if (!Number.isSafeInteger(detectedVersion) || detectedVersion < 17 || (version !== undefined && detectedVersion !== version)) continue;
      const javac = await output(path.join(home, 'bin', 'javac'), ['-version'], env, timeout);
      if (Number(javac.match(/\bjavac\s+(?:1\.)?(\d+)/)?.[1]) !== detectedVersion) continue;
      const resolvedHome = await realpath(home);
      const runtime = java.match(/^\s*java\.runtime\.version\s*=\s*(\S+)\s*$/m)?.[1]
        ?? java.match(/\bversion\s+"([^"]+)"/)?.[1];
      const runtimeVersion = typeof runtime === 'string' && runtime.length <= 128 && /^\d+(?:\.\d+)*(?:\+\d+)?(?:-LTS)?$/.test(runtime)
        ? runtime.replace(/-LTS$/, '') : undefined;
      const distribution = /^\s*java\.vendor\s*=\s*Eclipse Adoptium\s*$/m.test(java) ? 'temurin' : undefined;
      const arch = java.match(/^\s*os\.arch\s*=\s*(\S+)\s*$/m)?.[1];
      const architecture = ['x64', 'amd64', 'x86_64'].includes(arch ?? '') ? 'x64' : ['aarch64', 'arm64'].includes(arch ?? '') ? 'aarch64' : undefined;
      return { home: resolvedHome, version: detectedVersion, runtimeVersion, distribution, architecture, env: selectedEnvironment(resolvedHome, env) };
    } catch {
      // A candidate may be missing, a JRE, or an incompatible installation.
    }
  }
  return null;
}

async function candidateHomes(options: JdkOptions, major?: number) {
  const { platform, homeDir, env, cacheRoot } = settings(options);
  const candidates = [env.JAVA_HOME];
  if (major !== undefined) candidates.push(path.join(cacheRoot, String(major)));
  const sdkman = path.join(env.SDKMAN_CANDIDATES_DIR ?? path.join(homeDir, '.sdkman', 'candidates'), 'java');
  const systemRoots = options.systemRoots ?? (platform === 'darwin'
    ? ['/Library/Java/JavaVirtualMachines', path.join(homeDir, 'Library', 'Java', 'JavaVirtualMachines'), '/System/Library/Java/JavaVirtualMachines']
    : ['/usr/lib/jvm']);
  const directories = [sdkman, ...systemRoots];
  if (major === undefined) directories.unshift(cacheRoot);
  for (const directory of directories) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      candidates.push(...entries.filter(entry => (entry.isDirectory() || entry.isSymbolicLink())
        && (directory !== cacheRoot || /^\d+$/.test(entry.name))).map(entry => path.join(directory, entry.name)));
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(errorCode(error))) throw error;
    }
  }
  if (platform === 'darwin') {
    try { candidates.push((await output('/usr/libexec/java_home', major === undefined ? [] : ['-v', String(major)], env)).trim()); } catch {}
  }
  try {
    const java = await output('java', ['-XshowSettings:properties', '-version'], env);
    candidates.push(java.match(/^\s*java\.home\s*=\s*(.+)$/m)?.[1].trim());
  } catch {}
  return { candidates: [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))], env };
}

export async function listJdks(options: JdkOptions = {}) {
  const { candidates, env } = await candidateHomes(options);
  const installed = new Map<string, Jdk>();
  for (const candidate of candidates) {
    const result = await inspectHome(candidate, undefined, env);
    if (result) installed.set(result.home, result);
  }
  return [...installed.values()].sort((a, b) => a.version - b.version || a.home.localeCompare(b.home));
}

export async function resolveJdk(version: string | number | undefined, options: JdkOptions = {}) {
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
  if (options.installIfMissing) {
    options.onInstall?.();
    return installJdk(major, options);
  }
  throw new Error(`JDK ${major} was not found. Run "jpm jdk install ${major}", or set JAVA_HOME to a JDK ${major} installation (including javac).`);
}

async function exists(file: string) {
  try { await lstat(file); return true; } catch (error) { if (errorCode(error) === 'ENOENT') return false; throw error; }
}

async function readResponse(response: Response, limit: number) {
  if (!response.ok) throw new Error(`JDK metadata request failed: HTTP ${response.status}.`);
  if (!response.body) throw new Error('JDK metadata request returned an empty response.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('JDK metadata exceeded the size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function downloadTarget(options: JdkOptions) {
  const { platform } = settings(options);
  const arch = options.arch ?? process.arch;
  const architecture = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'aarch64' : undefined;
  if (!architecture) throw new Error('JDK downloads support x64 and arm64 processors.');
  return { architecture, os: platform === 'darwin' ? 'mac' : 'linux' } as const;
}

function archivePackage(archive: unknown) {
  if (!isRecord(archive) || typeof archive.link !== 'string' || typeof archive.checksum !== 'string' || !/^[a-f\d]{64}$/i.test(archive.checksum)
    || typeof archive.size !== 'number' || !Number.isSafeInteger(archive.size) || archive.size <= 0 || archive.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Adoptium did not return valid JDK archive metadata.');
  }
  const url = new URL(archive.link);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/adoptium/')) {
    throw new Error('Adoptium returned an unexpected JDK download URL.');
  }
  return { url, size: archive.size, checksum: archive.checksum };
}

function releaseUrl(major: number, target: ReturnType<typeof downloadTarget>, pageSize: number, page = 0) {
  const query = new URLSearchParams({ ...target, heap_size: 'normal', image_type: 'jdk', jvm_impl: 'hotspot', project: 'jdk', vendor: 'eclipse',
    page: String(page), page_size: String(pageSize), sort_method: 'DEFAULT', sort_order: 'DESC' });
  return `https://api.adoptium.net/v3/assets/feature_releases/${major}/ga?${query}`;
}

function releasePackage(asset: unknown, major: number, target: ReturnType<typeof downloadTarget>) {
  if (!isRecord(asset) || asset.release_type !== 'ga' || asset.vendor !== 'eclipse' || !isRecord(asset.version_data)
    || asset.version_data.major !== major || typeof asset.version_data.openjdk_version !== 'string' || asset.version_data.openjdk_version.length > 128
    || !/^\d+(?:\.\d+)*\+\d+(?:-LTS)?$/.test(asset.version_data.openjdk_version)
    || Number(asset.version_data.openjdk_version.split(/[.+]/)[0]) !== major || !Array.isArray(asset.binaries)) {
    throw new Error('Adoptium returned invalid JDK release metadata.');
  }
  const binary: unknown = asset.binaries.find((item: unknown) => isRecord(item) && item.os === target.os && item.architecture === target.architecture
    && item.image_type === 'jdk' && item.jvm_impl === 'hotspot' && item.heap_size === 'normal' && item.project === 'jdk');
  if (!isRecord(binary)) throw new Error('Adoptium returned a JDK release for an unexpected platform or image type.');
  const jdk: RemoteJdk = { version: major, runtimeVersion: asset.version_data.openjdk_version.replace(/-LTS$/, ''), distribution: 'temurin', architecture: target.architecture };
  return { jdk, archive: archivePackage(binary.package) };
}

export async function listRemoteJdks(version?: string | number, options: JdkOptions = {}): Promise<RemoteJdk[]> {
  const major = version === undefined ? undefined : majorVersion(version);
  const target = downloadTarget(options);
  const request = options.fetch ?? globalThis.fetch;
  const signal = AbortSignal.timeout(30_000);
  const readMetadata = async (url: string) => {
    const response = await request(url, { signal });
    return JSON.parse(await readResponse(response, 2 * 1024 * 1024)) as unknown;
  };
  let versions = major === undefined ? [] : [major];
  if (major === undefined) {
    const available = await readMetadata('https://api.adoptium.net/v3/info/available_releases');
    if (!isRecord(available) || !Array.isArray(available.available_releases)
      || !available.available_releases.every(value => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 99)) {
      throw new Error('Adoptium returned invalid available Java versions.');
    }
    versions = [...new Set<number>(available.available_releases)].filter(value => value >= 17);
  }
  const releases = await Promise.all(versions.map(async feature => {
    const found = new Map<string, RemoteJdk>();
    const pageSize = major === undefined ? 1 : 20;
    for (let page = 0; page < 100; page++) {
      const response = await request(releaseUrl(feature, target, pageSize, page), { signal });
      if (response.status === 404) return [...found.values()];
      const assets: unknown = JSON.parse(await readResponse(response, 2 * 1024 * 1024));
      if (!Array.isArray(assets) || assets.length > pageSize) throw new Error('Adoptium returned an invalid JDK release list.');
      for (const asset of assets) {
        const { jdk } = releasePackage(asset, feature, target);
        found.set(jdk.runtimeVersion, jdk);
      }
      if (major === undefined || assets.length < pageSize) return [...found.values()];
    }
    throw new Error('Adoptium JDK release history exceeded the pagination limit.');
  }));
  // Keep the API's numeric version ordering within each major, including patch/build components.
  return releases.flat().sort((a, b) => b.version - a.version);
}

export async function installJdk(version: string | number, options: JdkOptions = {}) {
  const major = majorVersion(version);
  const { env, cacheRoot } = settings(options);
  const target = downloadTarget(options);
  const destination = path.join(cacheRoot, String(major));
  if (await exists(destination)) {
    const installed = await inspectHome(destination, major, env);
    if (installed) return installed;
    throw new Error(`The existing JDK directory is incomplete or incompatible: ${destination}. Move it aside before retrying; jpm will not overwrite it.`);
  }

  await mkdir(cacheRoot, { recursive: true });
  const lock = `${destination}.lock`;
  try { await mkdir(lock); } catch (error) {
    if (errorCode(error) === 'EEXIST') throw new Error(`JDK ${major} installation is already in progress. If no installer is running, remove the stale lock directory: ${lock}`);
    throw error;
  }
  let staging;
  try {
    staging = await mkdtemp(path.join(cacheRoot, '.install-'));
    const request = options.fetch ?? globalThis.fetch;
    const response = await request(releaseUrl(major, target, 1), { signal: AbortSignal.timeout(30_000) });
    const assets: unknown = JSON.parse(await readResponse(response, 2 * 1024 * 1024));
    if (!Array.isArray(assets) || assets.length !== 1) throw new Error(`Adoptium did not return a Temurin JDK ${major} GA release for this platform.`);
    const { archive: { size: expectedSize, checksum, url } } = releasePackage(assets[0], major, target);
    const download = await request(url, { signal: AbortSignal.timeout(300_000) });
    if (!download.ok || !download.body) throw new Error(`JDK download failed: HTTP ${download.status}.`);
    if (download.url && new URL(download.url).protocol !== 'https:') throw new Error('JDK download redirected to an insecure URL.');
    const archivePath = path.join(staging, 'jdk.tar.gz');
    const hash = createHash('sha256');
    let bytes = 0;
    await pipeline(Readable.fromWeb(download.body), new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > expectedSize || bytes > MAX_ARCHIVE_BYTES) return callback(new Error('JDK archive exceeded its expected size.'));
        hash.update(chunk);
        callback(null, chunk);
      },
    }), createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
    if (bytes !== expectedSize || hash.digest('hex') !== checksum.toLowerCase()) {
      throw new Error('JDK archive checksum or size verification failed. Nothing was installed.');
    }
    const unpacked = path.join(staging, 'unpacked');
    await mkdir(unpacked);
    let extractedBytes = 0;
    let unsafeArchive = false;
    await extract({ file: archivePath, cwd: unpacked, strict: true, preserveOwner: false, chmod: true,
      filter(entryPath, entry) {
        if (!('type' in entry)) return false;
        extractedBytes += entry.size;
        const linkpath = entry.linkpath ?? '';
        const link = entry.type === 'SymbolicLink' ? path.posix.join(path.posix.dirname(entryPath), linkpath) : linkpath;
        if (entryPath.includes('\\') || path.posix.isAbsolute(entryPath) || entryPath.split('/').includes('..')
          || !['File', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)
          || (link && (path.posix.isAbsolute(linkpath) || link.includes('\\') || path.posix.normalize(link).split('/').includes('..')
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
    // macOS can spend tens of seconds checking a downloaded JDK on its first launch.
    if (!await inspectHome(extractedRoot, major, env, 60_000)) throw new Error('Downloaded JDK failed the java/javac version checks. Nothing was installed.');
    if (await exists(destination)) throw new Error(`JDK installation directory appeared during download: ${destination}. Nothing was overwritten.`);
    await rename(extractedRoot, destination);
    const installed = await inspectHome(destination, major, env, 60_000);
    if (!installed) throw new Error(`JDK installation could not be verified at ${destination}.`);
    return installed;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
