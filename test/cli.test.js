import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { c as pack } from 'tar';

const execute = promisify(execFile);
const binary = fileURLToPath(new URL('../bin/jpm.js', import.meta.url));

test('CLI help and invalid commands return useful exit statuses', async () => {
  assert.match((await execute(process.execPath, [binary, '--help'])).stdout, /jpm create/);
  await assert.rejects(execute(process.execPath, [binary, 'unknown']), error => error.code === 1 && /Unknown command/.test(error.stderr));
  await assert.rejects(execute(process.execPath, [binary, 'create', '../bad', '-y']), error => error.code === 1 && /project name/.test(error.stderr));
});

test('noninteractive entry points stay plain and never wait for a welcome or creation prompt', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'jpm-cli-plain-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const options = { cwd, timeout: 5000, env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' } };
  const help = (await execute(process.execPath, [binary], options)).stdout;
  assert.match(help, /jpm create/);
  assert.doesNotMatch(help, /\x1b|What would you like to do|[\u2800-\u28ff]/);
  const version = (await execute(process.execPath, [binary, '--version'], options)).stdout;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.]+)?\n$/);
  await assert.rejects(execute(process.execPath, [binary, 'create'], options), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Provide a project name/);
    assert.doesNotMatch(error.stdout, /\x1b|Project name|Java compile target/);
    return true;
  });
  await assert.rejects(execute(process.execPath, [binary, 'doctor'], options), error => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /ERROR Project:/);
    assert.doesNotMatch(error.stdout, /\x1b|[\u2800-\u28ff]/);
    return true;
  });
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
  const runWithFetch = async (args, source) => {
    const preload = path.join(directory, 'fetch.mjs');
    await writeFile(preload, source);
    return execute(process.execPath, ['--import', preload, binary, ...args], { cwd, env, timeout: 15_000 });
  };
  return { cwd, userDirectory, standalone, jdks, manifest, env, run, runWithFetch };
}

test('JDK list filters locally without fetching or marking an excluded selection current', async t => {
  const { cwd, runWithFetch } = await switchingFixture(t);
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  const noNetwork = 'globalThis.fetch = () => { throw new Error("Unexpected network request"); };';
  const output = (await runWithFetch(['jdk', 'list', '17'], noNetwork)).stdout;
  assert.match(output, /  Java 17\t/);
  assert.doesNotMatch(output, /\(current\)|Java 25/);
  assert.match(output, /Current selection: Java 21 \(outside this filter\)/);
  assert.match((await runWithFetch(['jdk', 'list', '91'], noNetwork)).stdout, /No installed Java 91 JDKs/);
  for (const args of [['list', '21.0.1'], ['list', '100'], ['list', '21', '17'], ['list', '--all'], ['list', '-d', 'temurin']]) {
    await assert.rejects(runWithFetch(['jdk', ...args], noNetwork), error => error.code === 1 && !/Unexpected network/.test(error.stderr));
  }
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
});

test('JDK i installs without selecting, use installs missing JDKs, and both reuse the cache', async t => {
  const { cwd, userDirectory, runWithFetch } = await switchingFixture(t);
  const source = path.join(cwd, 'archive');
  const bin = path.join(source, 'jdk-91', 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'java'), `#!${process.execPath}\nconsole.error('java.specification.version = 91');\n`, { mode: 0o755 });
  await writeFile(path.join(bin, 'javac'), `#!${process.execPath}\nconsole.log('javac 91.0.1');\n`, { mode: 0o755 });
  const archive = path.join(cwd, 'jdk.tar.gz');
  await pack({ gzip: true, cwd: source, file: archive }, ['jdk-91']);
  const data = await readFile(archive);
  const metadata = [{ release_type: 'ga', vendor: 'eclipse', version_data: { major: 91, openjdk_version: '91.0.1+1' }, binaries: [{
    os: process.platform === 'darwin' ? 'mac' : 'linux', architecture: process.arch === 'arm64' ? 'aarch64' : 'x64',
    image_type: 'jdk', jvm_impl: 'hotspot', heap_size: 'normal', project: 'jdk', package: {
    link: 'https://github.com/adoptium/temurin91-binaries/releases/download/test/jdk.tar.gz',
    size: data.length, checksum: createHash('sha256').update(data).digest('hex'),
  } }] }];
  const download = `import { readFile } from 'node:fs/promises';
    globalThis.fetch = async url => {
      const host = new URL(url).hostname;
      if (host === 'api.adoptium.net') return Response.json(${JSON.stringify(metadata)});
      if (host === 'github.com') return new Response(await readFile(${JSON.stringify(archive)}));
      throw new Error('Unexpected network request');
    };`;
  const noNetwork = 'globalThis.fetch = () => { throw new Error("Unexpected network request"); };';
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  assert.match((await runWithFetch(['jdk', 'i', '91'], download)).stdout, /Selection unchanged/);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
  await rm(path.join(userDirectory, '.jpm', 'jdks', '91'), { recursive: true });
  assert.match((await runWithFetch(['jdk', 'use', '91'], download)).stdout, /Downloading Temurin 91[\s\S]*Saved Java 91/);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=91\n');
  assert.doesNotMatch((await runWithFetch(['jdk', 'use', '91'], noNetwork)).stdout, /Downloading/);
  await runWithFetch(['jdk', 'i'], noNetwork);
  await runWithFetch(['jdk', 'install', '91'], noNetwork);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=91\n');
});

test('JDK use rejects incompatible targets before fetching and preserves selection after a download failure', async t => {
  const { cwd, manifest, runWithFetch } = await switchingFixture(t);
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  manifest.java.version = '99';
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  const failure = 'globalThis.fetch = async () => new Response("Unavailable", { status: 503 });';
  await assert.rejects(runWithFetch(['jdk', 'use', '91'], failure), error => {
    assert.match(error.stderr, /cannot build/);
    assert.doesNotMatch(error.stdout, /Downloading|Saved/);
    return error.code === 1;
  });
  await assert.rejects(runWithFetch(['jdk', 'use', '99'], failure), error => {
    assert.match(error.stdout, /Downloading Temurin 99/);
    assert.match(error.stderr, /HTTP 503/);
    return error.code === 1;
  });
  await assert.rejects(runWithFetch(['jdk', 'use', '100', '--global'], failure), error => {
    assert.match(error.stderr, /major version/);
    assert.doesNotMatch(error.stdout, /Downloading|Saved/);
    return error.code === 1;
  });
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
});

test('remote JDK listing marks only matching Temurin builds and stays useful when selection is missing', async t => {
  const { cwd, jdks, env, userDirectory, runWithFetch } = await switchingFixture(t);
  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const current = path.join(jdks, '21');
  const zulu = path.join(userDirectory, '.jpm', 'jdks', '21');
  await cp(current, zulu, { recursive: true });
  for (const [home, vendor, runtime] of [[current, 'Eclipse Adoptium', '21.0.1+12-LTS'], [zulu, 'Azul Systems, Inc.', '21.0.2+8-LTS']]) {
    await writeFile(path.join(home, 'bin', 'java'), `#!${process.execPath}\nconsole.error(${JSON.stringify(`java.specification.version = 21\njava.runtime.version = ${runtime}\njava.vendor = ${vendor}\nos.arch = ${architecture}`)});\n`, { mode: 0o755 });
  }
  env.JAVA_HOME = current;
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  const releases = ['21.0.2+8', '21.0.1+12-LTS'].map(runtime => ({
    release_type: 'ga', vendor: 'eclipse', version_data: { major: 21, openjdk_version: runtime },
    binaries: [{ os: process.platform === 'darwin' ? 'mac' : 'linux', architecture,
      image_type: 'jdk', jvm_impl: 'hotspot', heap_size: 'normal', project: 'jdk',
      package: { size: 1, checksum: '0'.repeat(64), link: 'https://github.com/adoptium/temurin21-binaries/releases/download/test/jdk.tar.gz' } }],
  }));
  const catalog = `globalThis.fetch = async url => {
    if (!String(url).startsWith('https://api.adoptium.net/v3/assets/feature_releases/21/ga?')) throw new Error('Unexpected network request');
    return Response.json(${JSON.stringify(releases)});
  };`;
  const output = (await runWithFetch(['jdk', 'list', '21', '-r'], catalog)).stdout;
  assert.match(output.split('\n')[1], /^\* 21\.0\.1\+12\s+Temurin\s+current$/);
  assert.match(output, /21\.0\.2\+8\s+Temurin\s+available/);
  assert.equal((await runWithFetch(['jdk', 'list', '--remote', '21'], catalog)).stdout, output);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
  await writeFile(path.join(cwd, '.jpmrc'), 'java=99\n');
  const missing = await runWithFetch(['jdk', 'list', '21', '-r'], catalog);
  assert.match(missing.stdout, /21\.0\.1\+12\s+Temurin\s+installed/);
  assert.match(missing.stderr, /Current selection could not be resolved/);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=99\n');
  await assert.rejects(runWithFetch(['jdk', 'list', '21', '-r'], 'globalThis.fetch = async () => new Response(null, { status: 503 });'), error => error.code === 1 && /HTTP 503/.test(error.stderr));
});

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
  assert.match((await run(['jdk'])).stdout, /^Installed JDKs.*\n\* Java 21 \(current\)[\s\S]+Selected by .*\.jpmrc/);
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
  assert.match((await run(['jdk'], standalone)).stdout, /^Installed JDKs.*\n\* Java 25 \(current\)/);
  assert.match((await run(['jdk'])).stdout, /^Installed JDKs.*\n\* Java 21 \(current\)/);
  const exports = (await run(['jdk', 'env', '17'])).stdout;
  assert.match(exports, /^export JAVA_HOME='[^\n]+';\nexport PATH='[^\n]+';\n\n?$/);
  assert.doesNotMatch(exports, /Saved|Selected|JDK:/);
  assert.match(exports, /java\/17/);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
  await assert.rejects(run(['jdk', 'env', '16']), error => error.code === 1 && error.stdout === '');
  assert.match((await run(['jdk', 'list'], standalone)).stdout, /Java 25 \(current\)[\s\S]+Java 17[\s\S]+Java 21/);
  await rm(path.join(cwd, '.jpmrc'));
  const child = path.join(cwd, 'src');
  await mkdir(child);
  assert.match((await run(['jdk'], child)).stdout, /\* Java 17 \(current\)[\s\S]+Selected by package\.json/);
});

test('JDK listing marks only the resolved installation and puts it first without changing selection', async t => {
  const { cwd, userDirectory, jdks, env } = await switchingFixture(t);
  const alternate = path.join(userDirectory, 'alternate-21');
  await cp(path.join(jdks, '21'), alternate, { recursive: true });
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  const options = { cwd, env: { ...env, JAVA_HOME: alternate } };
  const output = (await execute(process.execPath, [binary, 'jdk'], options)).stdout;
  assert.equal(output.split('\n')[1], `* Java 21 (current)\t${await realpath(alternate)}`);
  assert.equal((output.match(/\(current\)/g) ?? []).length, 1);
  assert.ok(output.includes(`  Java 21\t${await realpath(path.join(jdks, '21'))}`));
  assert.doesNotMatch(output, /\x1b/);
  assert.equal((await execute(process.execPath, [binary, 'jdk', 'list'], options)).stdout, output);
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
});

test('JDK listing handles absent, unavailable, and invalid selections without marking another JDK current', async t => {
  const { standalone, run } = await switchingFixture(t);
  const unconfigured = (await run(['jdk'], standalone)).stdout;
  assert.match(unconfigured, /Java 17/);
  assert.match(unconfigured, /No JDK selected for jpm/);
  assert.doesNotMatch(unconfigured, /\(current\)/);
  await assert.rejects(readFile(path.join(standalone, '.jpmrc')), { code: 'ENOENT' });
  for (const [config, message] of [['java=99\n', /JDK 99 was not found/], ['java=invalid\n', /major version/]]) {
    await writeFile(path.join(standalone, '.jpmrc'), config);
    await assert.rejects(run(['jdk', 'list'], standalone), error => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /Java 17/);
      assert.doesNotMatch(error.stdout, /\(current\)/);
      assert.match(error.stderr, message);
      return true;
    });
    assert.equal(await readFile(path.join(standalone, '.jpmrc'), 'utf8'), config);
  }
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
