import assert from 'node:assert/strict';
import childProcess, { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { c as pack } from 'tar';
import { installJdk, listJdks, listRemoteJdks, resolveJdk, shellEnvironment } from '../dist/jdk.js';

const execute = promisify(execFile);

async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'jpm-jdk-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, options: { homeDir: directory, cacheRoot: path.join(directory, 'cache'), platform: 'linux', systemRoots: [], arch: 'x64', env: { PATH: '' } } };
}

async function fakeJdk(home, version, { javacVersion = version, compiler = true, vendor = 'Example', runtimeVersion = `${version}.0.1+1`, architecture = 'amd64' } = {}) {
  await mkdir(path.join(home, 'bin'), { recursive: true });
  await writeFile(path.join(home, 'bin', 'java'), `#!${process.execPath}\nconsole.error('    java.specification.version = ${version}');\nconsole.error('    java.home = ' + require('node:path').resolve(__dirname, '..'));\nconsole.error(${JSON.stringify(`    java.vendor = ${vendor}`)});\nconsole.error(${JSON.stringify(`    java.runtime.version = ${runtimeVersion}`)});\nconsole.error(${JSON.stringify(`    os.arch = ${architecture}`)});\nconsole.error('openjdk version "${version}.0.1"');\n`);
  await chmod(path.join(home, 'bin', 'java'), 0o755);
  if (compiler) {
    await writeFile(path.join(home, 'bin', 'javac'), `#!${process.execPath}\nconsole.log('javac ${javacVersion}.0.1');\n`);
    await chmod(path.join(home, 'bin', 'javac'), 0o755);
  }
}

function mockDownload(data, checksum = createHash('sha256').update(data).digest('hex')) {
  let calls = 0;
  return async url => {
    calls++;
    if (calls === 1) {
      const request = new URL(url);
      assert.equal(request.hostname, 'api.adoptium.net');
      assert.equal(request.pathname, '/v3/assets/feature_releases/21/ga');
      assert.equal(request.searchParams.get('page_size'), '1');
      const release = remoteRelease(21);
      Object.assign(release.binaries[0].package, { checksum, size: data.length });
      return Response.json([release]);
    }
    assert.equal(new URL(url).hostname, 'github.com');
    return new Response(data);
  };
}

test('selects the requested JDK and changes only the returned environment', async t => {
  const { directory, options } = await fixture(t);
  const home = path.join(directory, 'jdk-21');
  await fakeJdk(home, 21);
  const env = { JAVA_HOME: home, PATH: '/example', KEEP: 'value' };
  const selected = await resolveJdk('21', { ...options, env, installIfMissing: true,
    onInstall: () => assert.fail('installed JDK must be reused'), fetch: () => assert.fail('must not download') });
  assert.equal(selected.version, 21);
  assert.equal(selected.home, home);
  assert.equal(selected.env.JAVA_HOME, home);
  assert.equal(selected.env.PATH, `${home}/bin:/example`);
  assert.equal(selected.env.KEEP, 'value');
  assert.equal(env.PATH, '/example');
});

test('a valid JAVA_HOME does not probe fallback Java installations or PATH', async t => {
  const { directory, options } = await fixture(t);
  const home = path.join(directory, 'jdk-21');
  await fakeJdk(home, 21);
  const probeBin = path.join(directory, 'path-bin');
  const marker = path.join(directory, 'path-java-was-run');
  await mkdir(probeBin);
  await writeFile(path.join(probeBin, 'java'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected');\n`, { mode: 0o755 });
  const env = { JAVA_HOME: home, PATH: probeBin };
  assert.equal((await resolveJdk(21, { ...options, env })).home, home);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await assert.rejects(resolveJdk(21, { ...options, platform: 'win32', env }), /Windows support/);
});

test('optional discovery directories do not block cached JDK resolution or listing', async t => {
  const { directory, options } = await fixture(t);
  const cached = path.join(options.cacheRoot, '21');
  await fakeJdk(cached, 21);
  const notDirectory = path.join(directory, 'not-a-directory');
  await writeFile(notDirectory, 'unrelated file');
  const denied = path.join(directory, 'denied', 'java');
  await mkdir(denied, { recursive: true });
  await chmod(denied, 0o000);
  try {
    for (const sdkman of [notDirectory, path.dirname(denied)]) {
      const configured = { ...options, env: { PATH: '', SDKMAN_CANDIDATES_DIR: sdkman } };
      assert.equal((await resolveJdk(21, configured)).home, cached);
      assert.ok((await listJdks(configured)).some(jdk => jdk.home === cached));
    }
  } finally {
    await chmod(denied, 0o755);
  }
});

test('skips a mismatched JAVA_HOME and finds a project cache JDK', async t => {
  const { directory, options } = await fixture(t);
  const oldHome = path.join(directory, 'jdk-17');
  const home = path.join(options.cacheRoot, '21', 'Contents', 'Home');
  await fakeJdk(oldHome, 17);
  await fakeJdk(home, 21);
  const selected = await resolveJdk(21, { ...options, env: { PATH: '', JAVA_HOME: oldHome } });
  assert.equal(selected.home, home);
});

test('discovers a JDK using java.home from PATH', async t => {
  const { directory, options } = await fixture(t);
  const home = path.join(directory, 'jdk-21');
  await fakeJdk(home, 21);
  assert.equal((await resolveJdk(21, { ...options, env: { PATH: path.join(home, 'bin') } })).home, home);
});

test('lists cached and SDKMAN JDKs once and excludes incomplete installations', async t => {
  const { directory, options } = await fixture(t);
  const cached = path.join(options.cacheRoot, '21');
  const sdkman = path.join(directory, '.sdkman', 'candidates', 'java');
  const managed = path.join(sdkman, '17.0.1-test');
  await fakeJdk(cached, 21);
  await fakeJdk(managed, 17);
  await fakeJdk(path.join(options.cacheRoot, '25'), 25, { compiler: false });
  await fakeJdk(path.join(options.cacheRoot, '.install-temporary'), 27);
  await symlink(managed, path.join(sdkman, 'current'));
  const list = await listJdks({ ...options, env: { JAVA_HOME: cached, PATH: path.join(cached, 'bin') } });
  assert.deepEqual(list.map(({ home, version }) => ({ home, version })), [
    { home: managed, version: 17 },
    { home: cached, version: 21 },
  ]);
});

test('shell exports preserve special characters without executing them', async t => {
  const { directory } = await fixture(t);
  const home = path.join(directory, "jdk's $(touch PWNED) `touch BACKTICK`");
  const oldHome = path.join(directory, 'previous jdk');
  const unrelated = "/keep's $(touch UNRELATED)";
  const env = { JAVA_HOME: oldHome, PATH: [path.join(oldHome, 'bin'), '/usr/bin', path.join(home, 'bin'), unrelated, path.join(home, 'bin')].join(path.delimiter) };
  const script = shellEnvironment({ home }, env);
  const { stdout } = await execute('/bin/sh', ['-c', 'eval "$JPM_ENV"\n"$NODE_EXE" -p \'JSON.stringify({home:process.env.JAVA_HOME,path:process.env.PATH})\''], {
    cwd: directory, env: { ...process.env, ...env, JPM_ENV: script, NODE_EXE: process.execPath },
  });
  assert.deepEqual(JSON.parse(stdout), { home, path: [path.join(home, 'bin'), '/usr/bin', unrelated].join(path.delimiter) });
  assert.deepEqual(await readdir(directory), []);
  assert.equal(env.JAVA_HOME, oldHome);
  assert.equal(env.PATH.split(path.delimiter).length, 5);
});

test('repeated JDK switches do not accumulate previous Java bin paths', async t => {
  const { directory, options } = await fixture(t);
  const first = path.join(options.cacheRoot, '17');
  const second = path.join(options.cacheRoot, '21');
  await fakeJdk(first, 17);
  await fakeJdk(second, 21);
  let env = { PATH: '/usr/bin', KEEP: 'untouched' };
  for (const major of [17, 21, 17, 21]) {
    const selected = await resolveJdk(major, { ...options, env });
    env = selected.env;
    assert.equal(env.PATH, `${selected.home}/bin:/usr/bin`);
    assert.equal(env.KEEP, 'untouched');
  }
  assert.throws(() => shellEnvironment({ home: 'relative' }), /absolute path/);
  assert.throws(() => shellEnvironment({ home: `${directory}/bad:path` }), /PATH separator/);
});

test('rejects a JRE and a compiler with a different major version', async t => {
  const { directory, options } = await fixture(t);
  for (const configuration of [{ compiler: false }, { javacVersion: 17 }]) {
    const home = await mkdtemp(path.join(directory, 'invalid-'));
    await fakeJdk(home, 21, configuration);
    await assert.rejects(resolveJdk(21, { ...options, env: { JAVA_HOME: home, PATH: '' } }), /jpm jdk install 21/);
  }
});

test('rejects invalid version paths and unsupported platforms before downloading', async () => {
  const options = { installIfMissing: true, onInstall: () => assert.fail('invalid request must not install'), fetch: () => assert.fail('must not download') };
  await assert.rejects(resolveJdk('../21', options), /major version/);
  await assert.rejects(resolveJdk(100, options), /major version/);
  await assert.rejects(resolveJdk(21, { ...options, platform: 'win32' }), /Windows support/);
  await assert.rejects(installJdk('21.0.1'), /major version/);
  await assert.rejects(installJdk(21, { platform: 'win32' }), /Windows support/);
});

test('checksum failure leaves no installation or staging files', async t => {
  const { options } = await fixture(t);
  await assert.rejects(installJdk(21, { ...options, fetch: mockDownload(Buffer.from('corrupt archive'), '0'.repeat(64)) }), /checksum/);
  assert.deepEqual(await readdir(options.cacheRoot), []);
});

test('installs a missing JDK only when requested and reuses its verified archive', async t => {
  const { directory, options } = await fixture(t);
  const source = path.join(directory, 'source');
  await fakeJdk(path.join(source, 'jdk-21'), 21);
  const archivePath = path.join(directory, 'jdk.tar.gz');
  await pack({ gzip: true, file: archivePath, cwd: source }, ['jdk-21']);
  const data = await readFile(archivePath);
  await assert.rejects(resolveJdk(21, { ...options, fetch: () => assert.fail('default resolution must not download') }), /was not found/);
  let installations = 0;
  const originalExecFile = childProcess.execFile;
  const probeTimeouts = [];
  const firstLaunch = (...args) => originalExecFile(...args);
  firstLaunch[promisify.custom] = async (command, args, executionOptions) => {
    if (command.includes(`${path.sep}.install-`) || (probeTimeouts.length && command.startsWith(`${options.cacheRoot}${path.sep}21${path.sep}`))) {
      probeTimeouts.push(executionOptions.timeout);
      if (executionOptions.timeout < 41_111) throw Object.assign(new Error('First launch exceeded its deadline'), { killed: true, signal: 'SIGTERM' });
    } else assert.equal(executionOptions.timeout, 10_000);
    return execute(command, args, executionOptions);
  };
  let installed;
  try {
    childProcess.execFile = firstLaunch;
    syncBuiltinESMExports();
    const freshModule = await import('../dist/jdk.js?slow-first-launch');
    installed = await freshModule.resolveJdk(21, { ...options, installIfMissing: true, onInstall: () => installations++, fetch: mockDownload(data) });
  } finally {
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
  }
  assert.deepEqual(probeTimeouts, [60_000, 60_000, 60_000, 60_000]);
  assert.equal(installations, 1);
  assert.equal(installed.home, path.join(options.cacheRoot, '21'));
  assert.deepEqual(await readdir(options.cacheRoot), ['21']);
  assert.equal((await installJdk(21, { ...options, fetch: () => assert.fail('must not fetch an installed JDK') })).home, installed.home);
});

test('identifies Temurin and its complete runtime version without mislabeling other vendors', async t => {
  const { options } = await fixture(t);
  for (const [major, vendor, runtimeVersion, architecture] of [[21, 'Eclipse Adoptium', '21.0.13+9-LTS', 'aarch64'], [25, 'Azul Systems, Inc.', '25.0.1+1-LTS', 'amd64']]) {
    await fakeJdk(path.join(options.cacheRoot, String(major)), major, { vendor, runtimeVersion, architecture });
  }
  const jdks = await listJdks(options);
  assert.deepEqual(jdks.map(({ distribution, runtimeVersion, architecture }) => ({ distribution, runtimeVersion, architecture })), [
    { distribution: 'temurin', runtimeVersion: '21.0.13+9', architecture: 'aarch64' }, { distribution: undefined, runtimeVersion: '25.0.1+1', architecture: 'x64' },
  ]);
});

function remoteRelease(major, runtimeVersion = `${major}.0.1+1-LTS`) {
  return {
    release_type: 'ga', vendor: 'eclipse', version_data: { major, openjdk_version: runtimeVersion },
    binaries: [{ os: 'linux', architecture: 'x64', image_type: 'jdk', jvm_impl: 'hotspot', heap_size: 'normal', project: 'jdk',
      package: { link: `https://github.com/adoptium/temurin${major}-binaries/releases/download/test/jdk.tar.gz`, checksum: 'a'.repeat(64), size: 200_000_000 } }],
  };
}

test('summarizes the latest remote GA JDK for each supported major without writing files', async t => {
  const { directory, options } = await fixture(t);
  const calls = [];
  const releases = await listRemoteJdks(undefined, { ...options, fetch: async input => {
    const url = new URL(input);
    calls.push(url.pathname);
    assert.equal(url.hostname, 'api.adoptium.net');
    if (url.pathname.endsWith('available_releases')) return Response.json({ available_releases: [8, 11, 17, 21, 21, 25, 28] });
    const major = Number(url.pathname.split('/')[4]);
    assert.match(url.pathname, /\/ga$/);
    for (const [key, value] of Object.entries({ page_size: '1', page: '0', os: 'linux', architecture: 'x64', image_type: 'jdk', jvm_impl: 'hotspot', project: 'jdk', vendor: 'eclipse', sort_order: 'DESC', sort_method: 'DEFAULT' })) {
      assert.equal(url.searchParams.get(key), value);
    }
    return major === 28 ? new Response(null, { status: 404 }) : Response.json([remoteRelease(major)]);
  } });
  assert.deepEqual(releases, [25, 21, 17].map(version => ({ version, runtimeVersion: `${version}.0.1+1`, distribution: 'temurin', architecture: 'x64' })));
  assert.equal(calls.length, 5);
  assert.deepEqual(await readdir(directory), []);
});

test('paginates a requested major and deduplicates remote builds', async t => {
  const { options } = await fixture(t);
  const pages = [];
  const releases = await listRemoteJdks('21', { ...options, fetch: async input => {
    const url = new URL(input);
    assert.equal(url.pathname, '/v3/assets/feature_releases/21/ga');
    assert.equal(url.searchParams.get('page_size'), '20');
    const page = Number(url.searchParams.get('page'));
    pages.push(page);
    return Response.json(page === 0 ? Array.from({ length: 20 }, (_, index) => remoteRelease(21, index === 0 ? '21.0.21.0.2+1-LTS' : `21.0.${21 - index}+1-LTS`))
      : [remoteRelease(21, '21.0.2+1-LTS'), remoteRelease(21, '21.0.1+1-LTS'), remoteRelease(21, '21+35-LTS')]);
  } });
  assert.deepEqual(pages, [0, 1]);
  assert.equal(releases.length, 22);
  assert.equal(releases[0].runtimeVersion, '21.0.21.0.2+1');
  assert.equal(releases.at(-1).runtimeVersion, '21+35');
});

test('remote catalog rejects malformed or failed metadata instead of claiming no releases', async t => {
  const { options } = await fixture(t);
  const missing = await listRemoteJdks(99, { ...options, fetch: async () => new Response(null, { status: 404 }) });
  assert.deepEqual(missing, []);
  await assert.rejects(listRemoteJdks(undefined, { ...options, fetch: async () => Response.json({ available_releases: ['21'] }) }), /invalid available/);
  await assert.rejects(listRemoteJdks(21, { ...options, fetch: async () => new Response('unavailable', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(listRemoteJdks(21, { ...options, fetch: async () => Response.json({ releases: [] }) }), /invalid JDK release list/);
  for (const change of [
    release => { release.release_type = 'ea'; },
    release => { release.version_data.openjdk_version = '\u001b[2J'; },
    release => { release.binaries[0].image_type = 'jre'; },
    release => { release.binaries[0].package.link = 'https://example.com/jdk.tar.gz'; },
  ]) {
    const release = remoteRelease(21);
    change(release);
    await assert.rejects(listRemoteJdks(21, { ...options, fetch: async () => Response.json([release]) }), /invalid|unexpected/);
  }
  for (const configuration of [{ platform: 'win32' }, { arch: 'ia32' }]) {
    await assert.rejects(listRemoteJdks(21, { ...options, ...configuration, fetch: () => assert.fail('must not query') }), /Windows support|x64 and arm64/);
  }
});

test('does not overwrite an existing incomplete installation', async t => {
  const { options } = await fixture(t);
  const destination = path.join(options.cacheRoot, '21');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'keep.txt'), 'keep');
  await assert.rejects(installJdk(21, { ...options, fetch: () => assert.fail('must not download') }), /will not overwrite/);
  assert.equal(await readFile(path.join(destination, 'keep.txt'), 'utf8'), 'keep');
});

test('rejects archive links outside the installation directory', async t => {
  const { directory, options } = await fixture(t);
  const source = path.join(directory, 'source');
  await fakeJdk(path.join(source, 'jdk-21'), 21);
  await symlink('/tmp/escape', path.join(source, 'jdk-21', 'unsafe'));
  const archivePath = path.join(directory, 'jdk.tar.gz');
  await pack({ gzip: true, file: archivePath, cwd: source }, ['jdk-21']);
  await assert.rejects(installJdk(21, { ...options, fetch: mockDownload(await readFile(archivePath)) }), /unsafe|outside/);
  assert.deepEqual(await readdir(options.cacheRoot), []);
});

test('rejects links that would escape the JDK after its directory is moved', async t => {
  const { directory, options } = await fixture(t);
  const source = path.join(directory, 'source');
  await fakeJdk(path.join(source, 'jdk-21'), 21);
  await symlink('..', path.join(source, 'jdk-21', 'unsafe'));
  const archivePath = path.join(directory, 'jdk.tar.gz');
  await pack({ gzip: true, file: archivePath, cwd: source }, ['jdk-21']);
  await assert.rejects(installJdk(21, { ...options, fetch: mockDownload(await readFile(archivePath)) }), /unsafe/);
  assert.deepEqual(await readdir(options.cacheRoot), []);
});

test('discovers system-root JDKs before falling back to PATH', async t => {
  const { directory, options } = await fixture(t);
  const root = path.join(directory, 'system-jvms');
  const installed = path.join(root, 'jdk-21');
  const pathHome = path.join(directory, 'path-jdk');
  await fakeJdk(installed, 21);
  await fakeJdk(pathHome, 21);
  const selected = await resolveJdk(21, {
    ...options, systemRoots: [root], env: { PATH: path.join(pathHome, 'bin') },
  });
  assert.equal(selected.home, installed);
});
