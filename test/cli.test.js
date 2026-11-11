import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
const binary = fileURLToPath(new URL('../bin/jpm.js', import.meta.url));

test('CLI help and invalid commands return useful exit statuses', async () => {
  assert.match((await execute(process.execPath, [binary, '--help'])).stdout, /jpm create/);
  await assert.rejects(execute(process.execPath, [binary, 'unknown']), error => error.code === 1 && /Unknown command/.test(error.stderr));
  await assert.rejects(execute(process.execPath, [binary, 'create', '../bad', '-y']), error => error.code === 1 && /project name/.test(error.stderr));
});

test('doctor reports multiple failures as JSON and returns a nonzero exit code without writing files', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-cli-doctor-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await assert.rejects(execute(process.execPath, [binary, 'doctor', '--json'], { cwd }), error => {
    const report = JSON.parse(error.stdout);
    assert.equal(error.code, 1);
    assert.equal(report.ok, false);
    assert.ok(report.checks.filter(check => check.status === 'error').length >= 2);
    return true;
  });
});

test('CLI sync and remove update Java dependencies without altering npm dependencies', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-cli-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const manifest = { name: 'demo', version: '0.1.0', dependencies: { example: '1.0.0' }, java: {
    version: '21', springBoot: '4.1.2', groupId: 'com.example', artifactId: 'demo',
    dependencies: { 'org.example:utility': '1.2.3' },
  } };
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  await execute(process.execPath, [binary, 'sync'], { cwd });
  assert.match(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), /<artifactId>utility<\/artifactId>/);
  await execute(process.execPath, [binary, 'remove', 'org.example:utility'], { cwd });
  const saved = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  assert.deepEqual(saved.dependencies, manifest.dependencies);
  assert.deepEqual(saved.java.dependencies, {});
  assert.doesNotMatch(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), /<artifactId>utility<\/artifactId>/);
});

test('updating a dependency preserves its test scope and optional flag', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-cli-add-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const javaHome = path.join(cwd, 'jdk');
  await mkdir(path.join(javaHome, 'bin'), { recursive: true });
  await writeFile(path.join(javaHome, 'bin', 'java'), `#!${process.execPath}\nconsole.error('java.specification.version = 21');\n`, { mode: 0o755 });
  await writeFile(path.join(javaHome, 'bin', 'javac'), `#!${process.execPath}\nconsole.log('javac 21.0.1');\n`, { mode: 0o755 });
  await writeFile(path.join(cwd, 'mvnw'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const manifest = { name: 'demo', version: '0.1.0', java: {
    version: '21', springBoot: '4.1.2', groupId: 'com.example', artifactId: 'demo',
    dependencies: { 'org.example:utility': { version: '1.0.0', scope: 'test', optional: true } },
  } };
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  await execute(process.execPath, [binary, 'add', 'org.example:utility@2.0.0'], { cwd, env: { ...process.env, JAVA_HOME: javaHome, SDKMAN_CANDIDATES_DIR: cwd, PATH: '' } });
  const saved = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  assert.deepEqual(saved.java.dependencies['org.example:utility'], { version: '2.0.0', scope: 'test', optional: true });
});

async function switchingFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jpm-cli-switch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = path.join(directory, 'project');
  const userDirectory = path.join(directory, 'user');
  const standalone = path.join(directory, 'standalone');
  await Promise.all([cwd, userDirectory, standalone].map(file => mkdir(file)));
  const jdks = path.join(userDirectory, '.sdkman', 'candidates', 'java');
  for (const major of [17, 21, 25]) {
    const bin = path.join(jdks, String(major), 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'java'), `#!${process.execPath}\nconsole.error('java.specification.version = ${major}');\n`, { mode: 0o755 });
    await writeFile(path.join(bin, 'javac'), `#!${process.execPath}\nconsole.log('javac ${major}.0.1');\n`, { mode: 0o755 });
  }
  const manifest = { name: 'demo', version: '0.1.0', java: {
    version: '17', springBoot: '4.1.2', groupId: 'com.example', artifactId: 'demo', dependencies: {},
  } };
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(cwd, 'mvnw'), `#!${process.execPath}\nrequire('node:fs').writeFileSync('selected-java.txt',process.env.JAVA_HOME);\n`, { mode: 0o755 });
  // This HOME belongs only to child processes, so --global cannot touch the real user config.
  const env = { ...process.env, HOME: userDirectory, JAVA_HOME: path.join(jdks, '17'), SDKMAN_CANDIDATES_DIR: path.dirname(jdks), PATH: '/usr/bin:/bin' };
  const run = (args, location = cwd) => execute(process.execPath, [binary, ...args], { cwd: location, env });
  return { cwd, userDirectory, standalone, jdks, manifest, env, run };
}

test('project JDK switching affects Maven while keeping the compile target and POM unchanged', async t => {
  const { cwd, manifest, run } = await switchingFixture(t);
  await run(['sync']);
  const pom = await readFile(path.join(cwd, 'pom.xml'), 'utf8');
  await run(['jdk', 'use', '21']);
  assert.match(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), /^java=21$/m);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')), manifest);
  assert.equal(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), pom);
  await run(['test']);
  assert.match(await readFile(path.join(cwd, 'selected-java.txt'), 'utf8'), /java\/21$/);
  assert.match((await run(['jdk'])).stdout, /JDK 21:.*\nSelected by .*\.jpmrc/s);
  manifest.java.version = '21';
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  await assert.rejects(run(['jdk', 'use', '17']), error => error.code === 1 && /cannot build/.test(error.stderr));
  const sourceDirectory = path.join(cwd, 'src');
  await mkdir(sourceDirectory);
  await assert.rejects(run(['jdk', 'use', '17'], sourceDirectory), error => error.code === 1 && /cannot build/.test(error.stderr));
  assert.match(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), /java=21/);
  await writeFile(path.join(cwd, '.jpmrc'), 'java=17\n');
  await assert.rejects(run(['build']), error => error.code === 1 && /cannot build/.test(error.stderr));
});

test('global selection stays separate and shell env emits only exports without changing files', async t => {
  const { cwd, userDirectory, standalone, run } = await switchingFixture(t);
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  await run(['jdk', 'use', '25', '--global']);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
  assert.match(await readFile(path.join(userDirectory, '.jpmrc'), 'utf8'), /java=25/);
  assert.match((await run(['jdk'], standalone)).stdout, /JDK 25:/);
  assert.match((await run(['jdk'])).stdout, /JDK 21:/);
  const exports = (await run(['jdk', 'env', '17'])).stdout;
  assert.match(exports, /^export JAVA_HOME='[^\n]+';\nexport PATH='[^\n]+';\n\n?$/);
  assert.doesNotMatch(exports, /Saved|Selected|JDK:/);
  assert.match(exports, /java\/17/);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
  await assert.rejects(run(['jdk', 'env', '16']), error => error.code === 1 && error.stdout === '');
  assert.match((await run(['jdk', 'list'], standalone)).stdout, /Java 17[\s\S]+Java 21[\s\S]+Java 25/);
  await rm(path.join(cwd, '.jpmrc'));
  const child = path.join(cwd, 'src');
  await mkdir(child);
  assert.match((await run(['jdk'], child)).stdout, /JDK 17:.*\nSelected by package\.json/s);
});

test('list shows declared dependencies as text and JSON without using Java or writing a POM', async t => {
  const { cwd, manifest, run } = await switchingFixture(t);
  manifest.java.dependencies = {
    'org.example:zebra': '1.2.3',
    'org.example:alpha': { scope: 'test', optional: true },
  };
  const original = JSON.stringify(manifest);
  await writeFile(path.join(cwd, 'package.json'), original);
  await writeFile(path.join(cwd, '.jpmrc'), 'invalid configuration\n');
  const result = JSON.parse((await run(['list', '--json'])).stdout);
  assert.deepEqual(result, { dependencies: [
    { coordinate: 'org.example:alpha', version: null, scope: 'test', optional: true },
    { coordinate: 'org.example:zebra', version: '1.2.3', scope: 'compile', optional: false },
  ] });
  assert.match((await run(['list'])).stdout, /org.example:alpha\tmanaged by Spring Boot\ttest\toptional/);
  assert.equal(await readFile(path.join(cwd, 'package.json'), 'utf8'), original);
  for (const filename of ['pom.xml', 'selected-java.txt']) await assert.rejects(readFile(path.join(cwd, filename)), { code: 'ENOENT' });
  await assert.rejects(run(['list', 'unexpected']), error => error.code === 1 && /Usage: jpm list/.test(error.stderr));
  manifest.java.dependencies = {};
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  assert.match((await run(['list'])).stdout, /No direct Java dependencies/);
});

test('tree runs the Maven goal and forwards arguments including --help with the original exit code', async t => {
  const { cwd, run } = await switchingFixture(t);
  await writeFile(path.join(cwd, 'mvnw'), `#!${process.execPath}\nrequire('node:fs').writeFileSync('maven-args.json', JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n`, { mode: 0o755 });
  const args = ['-Dincludes=org.apache.commons:*', '--help'];
  await assert.rejects(run(['tree', '--', ...args]), error => error.code === 7);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'maven-args.json'), 'utf8')), ['dependency:tree', ...args]);
  assert.match(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), /Generated by jpm/);
  await assert.rejects(run(['tree', '-Dverbose']), error => error.code === 1 && /after --/.test(error.stderr));
  assert.match((await run(['tree', '--help'])).stdout, /jpm tree/);
});

test('add leaves JSON and POM untouched when configuration, JDK compatibility or Wrapper preflight fails', async t => {
  const { cwd, manifest, run } = await switchingFixture(t);
  manifest.java.version = '21';
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  await run(['sync']);
  const before = await Promise.all(['package.json', 'pom.xml'].map(file => readFile(path.join(cwd, file), 'utf8')));
  const unchanged = async () => assert.deepEqual(await Promise.all(['package.json', 'pom.xml'].map(file => readFile(path.join(cwd, file), 'utf8'))), before);
  const args = ['add', 'org.example:another@1.0.0'];
  await writeFile(path.join(cwd, '.jpmrc'), 'unsupported=true\n');
  await assert.rejects(run(args), error => error.code === 1 && /unsupported setting/.test(error.stderr));
  await unchanged();
  await writeFile(path.join(cwd, '.jpmrc'), 'java=17\n');
  await assert.rejects(run(args), error => error.code === 1 && /cannot build/.test(error.stderr));
  await unchanged();
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  await rm(path.join(cwd, 'mvnw'));
  await assert.rejects(run(args), error => error.code === 1 && /Maven Wrapper/.test(error.stderr));
  await unchanged();
  await mkdir(path.join(cwd, 'mvnw'));
  await assert.rejects(run(args), error => error.code === 1 && /Maven Wrapper/.test(error.stderr));
  await unchanged();
});

test('add retains a saved dependency after Maven failure and explains how to retry', async t => {
  const { cwd, run } = await switchingFixture(t);
  await writeFile(path.join(cwd, 'mvnw'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
  await assert.rejects(run(['add', 'org.example:another@1.0.0']), error => {
    assert.equal(error.code, 7);
    assert.match(error.stderr, /remains saved in package.json and pom.xml/);
    assert.match(error.stderr, /retry jpm install/);
    return true;
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')).java.dependencies['org.example:another'], { version: '1.0.0' });
  assert.match(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), /<artifactId>another<\/artifactId>/);
});
