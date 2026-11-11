import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, chmod, lstat, rename, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { XMLParser } from 'fast-xml-parser';
import { parseDependency, renderPom, validateManifest, syncPom, saveProject, readProject, inspectPom } from '../src/project.js';

const project = () => ({ name: 'my-app', version: '0.0.1-SNAPSHOT', description: 'A & B <demo>', java: {
  version: '21', springBoot: '4.1.2', groupId: 'com.example', artifactId: 'my-app', packageName: 'com.example.myapp',
  dependencies: {
    'org.springframework.boot:spring-boot-starter-webmvc': {},
    'org.springframework.boot:spring-boot-starter-webmvc-test': { scope: 'test' },
    'org.springframework.boot:spring-boot-devtools': { scope: 'runtime', optional: true },
    'org.example:utility': '1.2.3',
  },
} });

test('POM preserves Boot version management, test scope, optional dependencies, and XML text', () => {
  const pom = new XMLParser().parse(renderPom(project())).project;
  assert.equal(pom.parent.version, '4.1.2');
  assert.equal(pom.properties['java.version'], 21);
  assert.equal(pom.description, 'A & B <demo>');
  const deps = Object.fromEntries(pom.dependencies.dependency.map(dep => [dep.artifactId, dep]));
  assert.equal(deps['spring-boot-starter-webmvc'].version, undefined);
  assert.equal(deps['spring-boot-starter-webmvc-test'].scope, 'test');
  assert.equal(deps['spring-boot-devtools'].optional, true);
  assert.equal(deps.utility.version, '1.2.3');
});

test('dependency parsing rejects npm ranges and command-like malformed input', () => {
  assert.deepEqual(parseDependency('org.example:utility@1.2.3'), { coordinate: 'org.example:utility', dependency: { version: '1.2.3' } });
  assert.deepEqual(parseDependency('org.example:utility'), { coordinate: 'org.example:utility', dependency: {} });
  for (const invalid of ['lodash', 'org:x@^1.2.3', 'org:x@', 'org:x@1@2', 'org:x;echo@1']) assert.throws(() => parseDependency(invalid));
  const manifest = project();
  manifest.java.dependencies['org:bad'] = { version: '~1.0' };
  assert.throws(() => validateManifest(manifest), /exact Maven version/);
  delete manifest.java.dependencies['org:bad'];
  manifest.java.dependecies = {};
  assert.throws(() => validateManifest(manifest), /Unsupported java setting/);
});

test('sync is stable and refuses to destroy a manually edited or unmanaged POM', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-project-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const manifest = project();
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  assert.deepEqual(await inspectPom(cwd), { status: 'missing' });
  const rendered = await syncPom(cwd);
  assert.equal(await syncPom(cwd), rendered);
  assert.deepEqual(await inspectPom(cwd), { status: 'current' });
  manifest.java.dependencies['org.example:utility'] = '2.0.0';
  assert.deepEqual(await inspectPom(cwd, manifest), { status: 'stale' });
  assert.equal(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), rendered);
  await saveProject(cwd, manifest);
  assert.equal((await readProject(cwd)).java.dependencies['org.example:utility'], '2.0.0');
  const modified = (await readFile(path.join(cwd, 'pom.xml'), 'utf8')).replace('<version>2.0.0</version>', '<version>3.0.0</version>');
  await writeFile(path.join(cwd, 'pom.xml'), modified);
  assert.equal((await inspectPom(cwd)).status, 'modified');
  await assert.rejects(syncPom(cwd), /manual changes/);
  manifest.java.version = '25';
  await assert.rejects(saveProject(cwd, manifest), /manual changes/);
  assert.equal((await readProject(cwd)).java.version, '21');
  assert.equal(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), modified);
  await writeFile(path.join(cwd, 'pom.xml'), '<project/>');
  await assert.rejects(syncPom(cwd), /unmanaged/);
});

test('saving dependencies and syncing the POM preserve existing file permissions', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-project-modes-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const manifest = project();
  const packageFile = path.join(cwd, 'package.json');
  const pomFile = path.join(cwd, 'pom.xml');
  await writeFile(packageFile, JSON.stringify(manifest));
  await syncPom(cwd);
  await chmod(packageFile, 0o600);
  await chmod(pomFile, 0o640);
  manifest.java.dependencies['org.example:utility'] = '2.0.0';
  await saveProject(cwd, manifest);
  assert.equal((await lstat(packageFile)).mode & 0o777, 0o600);
  assert.equal((await lstat(pomFile)).mode & 0o777, 0o640);
  manifest.java.dependencies['org.example:utility'] = '3.0.0';
  await writeFile(packageFile, JSON.stringify(manifest));
  await syncPom(cwd);
  assert.equal((await lstat(packageFile)).mode & 0o777, 0o600);
  assert.equal((await lstat(pomFile)).mode & 0o777, 0o640);
  assert.match(await readFile(pomFile, 'utf8'), /<version>3\.0\.0<\/version>/);
});

test('dependency writes reject symlinked manifests and POMs without changing their targets', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-project-links-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const manifest = project();
  const packageFile = path.join(cwd, 'package.json');
  const pomFile = path.join(cwd, 'pom.xml');
  const originalManifest = `${JSON.stringify(manifest)}\n`;
  await writeFile(packageFile, originalManifest);
  const originalPom = await syncPom(cwd);
  manifest.java.dependencies['org.example:utility'] = '2.0.0';
  for (const file of [packageFile, pomFile]) {
    const target = `${file}.real`;
    await rename(file, target);
    await symlink(target, file);
    await assert.rejects(saveProject(cwd, manifest), /symlinked/);
    if (file === pomFile) await assert.rejects(syncPom(cwd, manifest), /symlinked/);
    assert.ok((await lstat(file)).isSymbolicLink());
    assert.equal(await readFile(packageFile, 'utf8'), originalManifest);
    assert.equal(await readFile(pomFile, 'utf8'), originalPom);
    await rm(file);
    await rename(target, file);
  }
});
