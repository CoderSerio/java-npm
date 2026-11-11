import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as tar from 'tar';
import { packCli } from '../src/distribution.js';

async function workspace(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jpm-distribution-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('packs the running CLI with npm metadata and executable modules only', async t => {
  const cwd = await workspace(t);
  const destination = path.join(cwd, 'vendor with spaces');
  const artifact = await packCli(destination);
  assert.equal(artifact.name, 'java-npm');
  assert.match(artifact.version, /^\d+\.\d+\.\d+/);
  const archive = path.join(destination, artifact.filename);
  const entries = [];
  await tar.t({ file: archive, strict: true, onReadEntry: entry => entries.push(entry.path) });
  for (const required of ['package/package.json', 'package/bin/jpm.js', 'package/src/cli.js', 'package/src/config.js', 'package/src/distribution.js']) assert.ok(entries.includes(required), required);
  assert.ok(entries.every(entry => entry.startsWith('package/') && !entry.includes('..')));
  assert.ok(entries.every(entry => !/\/node_modules\/|\/test\/|\.baseline\.json|\.tgz$/.test(entry)));
  const extracted = path.join(cwd, 'unpacked');
  await mkdir(extracted);
  await tar.x({ file: archive, cwd: extracted, strict: true, preserveOwner: false });
  const manifest = JSON.parse(await readFile(path.join(extracted, 'package/package.json'), 'utf8'));
  assert.equal(manifest.name, artifact.name);
  assert.equal(manifest.version, artifact.version);
  assert.deepEqual(manifest.bin, { jpm: 'bin/jpm.js' });
  assert.equal(manifest.private, true);
  assert.ok(Object.values(manifest.dependencies).every(specifier => !specifier.startsWith('file:')));
  assert.deepEqual(await readdir(destination), [artifact.filename]);
});

test('refuses to replace an existing distribution artifact', async t => {
  const directory = await workspace(t);
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const filename = `java-npm-${metadata.version}.tgz`;
  await writeFile(path.join(directory, filename), 'keep');
  await assert.rejects(packCli(directory), /Refusing to overwrite/);
  assert.equal(await readFile(path.join(directory, filename), 'utf8'), 'keep');
});
