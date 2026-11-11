import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import * as tar from 'tar';

const execute = promisify(execFile);

test('release archive contains built modules and no source, tests, or compiler', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jpm-package-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await execute('npm', ['pack', '--offline', '--ignore-scripts', '--pack-destination', directory,
    '--cache', path.join(directory, 'cache')], { cwd: root, timeout: 30_000 });
  const archive = path.join(directory, `java-npm-${metadata.version}.tgz`);
  const entries = [];
  await tar.t({ file: archive, strict: true, onReadEntry: entry => entries.push(entry.path) });
  for (const required of ['package/package.json', 'package/bin/jpm.js', 'package/dist/cli.js', 'package/dist/config.js',
    'package/LICENSE', 'package/README.md', 'package/README.zh-CN.md', 'package/docs/cli.md',
    'package/assets/brand/jpm-readme.png']) {
    assert.ok(entries.includes(required), required);
  }
  assert.ok(entries.every(entry => entry.startsWith('package/') && !entry.includes('..')));
  assert.ok(entries.every(entry => !/\/node_modules\/|\/test\/|\/src\/|\.ts$|\.tgz$/.test(entry)));
  const extracted = path.join(directory, 'unpacked');
  await mkdir(extracted);
  await tar.x({ file: archive, cwd: extracted, strict: true, preserveOwner: false });
  const manifest = JSON.parse(await readFile(path.join(extracted, 'package/package.json'), 'utf8'));
  assert.equal(manifest.name, 'java-npm');
  assert.equal(manifest.version, metadata.version);
  assert.deepEqual(manifest.bin, { jpm: 'bin/jpm.js' });
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.publishConfig, { access: 'public', tag: 'alpha' });
  assert.equal(manifest.engines.node, '>=26');
  assert.equal(manifest.license, 'MIT');
  assert.ok(Object.values(manifest.dependencies).every(specifier => !specifier.startsWith('file:')));
});
