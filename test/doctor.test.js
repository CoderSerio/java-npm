import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectDoctor } from '../src/doctor.js';
import { renderPom } from '../src/project.js';

async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'jpm-doctor-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = path.join(directory, 'project');
  const homeDir = path.join(directory, 'user');
  const jdk = path.join(homeDir, 'jdk');
  await mkdir(path.join(cwd, '.mvn', 'wrapper'), { recursive: true });
  await mkdir(path.join(jdk, 'bin'), { recursive: true });
  await writeFile(path.join(jdk, 'bin', 'java'), `#!${process.execPath}\nconsole.error('java.specification.version = 21');\nconsole.error('java.home = ' + require('node:path').resolve(__dirname, '..'));\n`, { mode: 0o755 });
  await writeFile(path.join(jdk, 'bin', 'javac'), `#!${process.execPath}\nconsole.log('javac 21.0.1');\n`, { mode: 0o755 });
  const manifest = { name: 'demo', version: '0.1.0', java: {
    version: '17', springBoot: '4.1.2', groupId: 'com.example', artifactId: 'demo', dependencies: {},
  } };
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  await writeFile(path.join(cwd, 'pom.xml'), renderPom(manifest));
  // If doctor ever runs Maven, this fixture creates an observable file.
  await writeFile(path.join(cwd, 'mvnw'), `#!${process.execPath}\nrequire('node:fs').writeFileSync('maven-was-run', 'unexpected');\n`, { mode: 0o755 });
  await writeFile(path.join(cwd, '.mvn', 'wrapper', 'maven-wrapper.properties'), 'distributionUrl=https://example.invalid/maven.zip\n');
  return { cwd, manifest, options: { homeDir, platform: 'linux', nodeVersion: '22.23.4', env: { JAVA_HOME: jdk, PATH: path.join(jdk, 'bin'), SDKMAN_CANDIDATES_DIR: path.join(homeDir, '.sdkman', 'candidates') } } };
}

async function snapshot(directory) {
  const files = await readdir(directory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(await Promise.all(files.filter(file => file.isFile()).map(async file => {
    const absolute = path.join(file.parentPath, file.name);
    return [path.relative(directory, absolute), { content: await readFile(absolute, 'utf8'), mode: (await stat(absolute)).mode }];
  })));
}

const named = (result, name) => result.checks.find(check => check.name === name);

test('healthy doctor reports configuration and JDK without writing files or running Maven', async t => {
  const { cwd, options } = await fixture(t);
  const before = await snapshot(cwd);
  const result = await inspectDoctor(cwd, options);
  assert.equal(result.ok, true);
  assert.ok(result.checks.every(check => check.status === 'ok'));
  assert.match(named(result, 'Java configuration').detail, /selected by .*\.jpmrc/);
  assert.match(named(result, 'Compile target').detail, /Java 17 target, JDK 21/);
  assert.deepEqual(await snapshot(cwd), before);
});

test('doctor aggregates malformed project/config, unsupported Node, and missing Wrapper', async t => {
  const { cwd, options } = await fixture(t);
  await writeFile(path.join(cwd, 'package.json'), '{broken');
  await writeFile(path.join(cwd, '.jpmrc'), 'java=invalid\n');
  await rm(path.join(cwd, 'mvnw'));
  await rm(path.join(cwd, '.mvn', 'wrapper', 'maven-wrapper.properties'));
  const before = await snapshot(cwd);
  const result = await inspectDoctor(cwd, { ...options, nodeVersion: '20.19.0' });
  assert.equal(result.ok, false);
  for (const name of ['Node.js', 'Project', 'Java configuration', 'Maven Wrapper']) assert.equal(named(result, name).status, 'error');
  assert.match(named(result, 'Project').action, /jpm doctor/);
  assert.match(named(result, 'Maven Wrapper').detail, /mvnw.*missing.*properties.*missing/);
  assert.equal(named(result, 'POM').status, 'warn');
  assert.match(named(result, 'POM').action, /jpm doctor/);
  assert.deepEqual(await snapshot(cwd), before);
});

test('doctor distinguishes stale/missing POMs from manual edits and never repairs them', async t => {
  const { cwd, options, manifest } = await fixture(t);
  manifest.description = 'Changed manifest';
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  const oldPom = await readFile(path.join(cwd, 'pom.xml'), 'utf8');
  let result = await inspectDoctor(cwd, options);
  assert.match(named(result, 'POM').detail, /out of date/);
  assert.equal(named(result, 'POM').action, 'Run jpm sync.');
  assert.equal(await readFile(path.join(cwd, 'pom.xml'), 'utf8'), oldPom);
  await writeFile(path.join(cwd, 'pom.xml'), oldPom.replace('<name>demo</name>', '<name>manual</name>'));
  result = await inspectDoctor(cwd, options);
  assert.match(named(result, 'POM').action, /Back up and review.*jpm sync/);
  await rm(path.join(cwd, 'pom.xml'));
  result = await inspectDoctor(cwd, options);
  assert.match(named(result, 'POM').detail, /missing/);
  assert.equal(named(result, 'POM').action, 'Run jpm sync.');
});

test('doctor reports incompatible or missing JDKs and warns when the shell differs', async t => {
  const { cwd, options, manifest } = await fixture(t);
  const mismatchedShell = await inspectDoctor(cwd, { ...options, env: { ...options.env, PATH: '' } });
  assert.equal(mismatchedShell.ok, true);
  assert.equal(named(mismatchedShell, 'Shell environment').status, 'warn');
  assert.equal(named(mismatchedShell, 'Shell environment').action, 'To switch this terminal too, run: eval "$(jpm jdk env)"');
  const loop = path.join(cwd, 'loop');
  await symlink('loop', loop);
  const unreadablePath = await inspectDoctor(cwd, { ...options, env: { ...options.env, PATH: loop } });
  assert.equal(unreadablePath.ok, true);
  assert.equal(unreadablePath.checks.filter(check => check.name === 'JDK').length, 1);
  assert.equal(named(unreadablePath, 'JDK').status, 'ok');
  assert.equal(named(unreadablePath, 'Shell environment').status, 'warn');
  assert.match(named(unreadablePath, 'Shell environment').action, /Review JAVA_HOME and PATH.*jpm doctor/);
  manifest.java.version = '25';
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  let result = await inspectDoctor(cwd, options);
  assert.equal(named(result, 'Compile target').status, 'error');
  assert.match(named(result, 'Compile target').action, /jpm jdk use 25/);
  await writeFile(path.join(cwd, '.jpmrc'), 'java=99\n');
  result = await inspectDoctor(cwd, options);
  assert.equal(named(result, 'JDK').status, 'error');
  assert.match(named(result, 'JDK').action, /jpm jdk install 99/);
});
