import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

export async function packCli(destination) {
  const metadata = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  if (metadata.name !== 'java-npm' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(metadata.version)) {
    throw new Error('Cannot package this CLI: expected java-npm with an exact package version.');
  }
  const filename = `java-npm-${metadata.version}.tgz`;
  const output = path.join(path.resolve(destination), filename);
  try {
    await lstat(output);
    throw new Error(`Refusing to overwrite an existing CLI archive: ${output}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(destination, { recursive: true });
  const cache = await mkdtemp(path.join(tmpdir(), 'jpm-pack-cache-'));
  try {
    const { stdout } = await execute('npm', [
      'pack', '--offline', '--ignore-scripts', '--json', '--loglevel=error',
      '--pack-destination', path.resolve(destination), '--cache', cache,
    ], { cwd: PACKAGE_ROOT, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    const packed = JSON.parse(stdout);
    if (!Array.isArray(packed) || packed.length !== 1 || packed[0].filename !== filename
      || packed[0].name !== metadata.name || packed[0].version !== metadata.version
      || !(await lstat(output)).isFile()) {
      throw new Error('npm pack returned an unexpected CLI archive.');
    }
    return { name: metadata.name, version: metadata.version, filename };
  } catch (error) {
    throw new Error(`Could not prepare the portable java-npm package: ${error.stderr?.trim() || error.message}`, { cause: error });
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}
