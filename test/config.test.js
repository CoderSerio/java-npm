import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseJpmrc, readJavaConfig, writeJavaConfig } from '../dist/config.js';

async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'jpm-config-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const homeDir = path.join(directory, 'home');
  const cwd = path.join(homeDir, 'project');
  await mkdir(cwd, { recursive: true });
  return { directory, homeDir, cwd };
}

test('parses the supported npmrc syntax and rejects ambiguous or executable values', () => {
  assert.deepEqual(parseJpmrc('\uFEFF# JDK\r\n; comment\r\n\r\n java = 21 ; selected\r\n'), { java: '21' });
  assert.deepEqual(parseJpmrc('# nothing selected\n'), {});
  for (const invalid of ['java=16', 'java=100', 'java=021', 'java=21.0.1', 'java=${JAVA_VERSION}', 'java=$(touch x)', 'java=21\njava=25', 'jdk=21', '[java]\nversion=21', 'java']) {
    assert.throws(() => parseJpmrc(invalid, '/project/.jpmrc'), /\/project\/\.jpmrc:\d+:/);
  }
});

test('uses project config, then legacy project target, then user default', async t => {
  const { homeDir, cwd } = await fixture(t);
  const userFile = path.join(homeDir, '.jpmrc');
  const projectFile = path.join(cwd, '.jpmrc');
  await writeFile(userFile, 'java=17\n');
  assert.deepEqual(await readJavaConfig(cwd, { homeDir }), { version: '17', source: userFile, projectFile: undefined });
  assert.equal((await readJavaConfig(cwd, { homeDir, fallbackVersion: 21 })).version, '21');
  await writeFile(projectFile, 'java=25\n');
  assert.deepEqual(await readJavaConfig(cwd, { homeDir, fallbackVersion: '21' }), { version: '25', source: projectFile, projectFile });
  await writeFile(projectFile, '# inherit\n');
  assert.deepEqual(await readJavaConfig(cwd, { homeDir, fallbackVersion: '21' }), { version: '21', source: 'package.json', projectFile });
  assert.equal((await readJavaConfig(cwd, { homeDir })).version, '17');
  await writeFile(userFile, '# no default\n');
  assert.equal((await readJavaConfig(cwd, { homeDir })).version, undefined);
});

test('finds the nearest rc but stops at home, package, and repository boundaries', async t => {
  const { homeDir, cwd } = await fixture(t);
  const child = path.join(cwd, 'src', 'main');
  await mkdir(child, { recursive: true });
  await writeFile(path.join(homeDir, '.jpmrc'), 'java=17\n');
  await writeFile(path.join(cwd, '.jpmrc'), 'java=25\n');
  assert.equal((await readJavaConfig(child, { homeDir })).source, path.join(cwd, '.jpmrc'));
  await writeFile(path.join(cwd, 'src', '.jpmrc'), 'java=21\n');
  assert.equal((await readJavaConfig(child, { homeDir })).version, '21');
  await mkdir(path.join(child, '.git'));
  assert.equal((await readJavaConfig(child, { homeDir })).version, '17');
  assert.equal((await readJavaConfig(child, { homeDir, fallbackVersion: '21' })).source, 'package.json');
  await rm(path.join(child, '.git'), { recursive: true });
  await writeFile(path.join(child, 'package.json'), '{}');
  assert.equal(await writeJavaConfig(child, 21, { homeDir }), path.join(child, '.jpmrc'));
  assert.deepEqual(await readJavaConfig(homeDir, { homeDir, fallbackVersion: '21' }), { version: '21', source: 'package.json', projectFile: undefined });
});

test('malformed known configs fail even if another value has precedence', async t => {
  const { homeDir, cwd } = await fixture(t);
  await writeFile(path.join(homeDir, '.jpmrc'), 'java=invalid\n');
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  await assert.rejects(readJavaConfig(cwd, { homeDir }), /java must/);
  await writeFile(path.join(homeDir, '.jpmrc'), 'java=17\n');
  await writeFile(path.join(cwd, '.jpmrc'), 'java=invalid\n');
  await assert.rejects(readJavaConfig(cwd, { homeDir, fallbackVersion: '21' }), /java must/);
});

test('creates the first project rc at its package or repository boundary from a subdirectory', async t => {
  const { directory, homeDir, cwd } = await fixture(t);
  const userFile = path.join(homeDir, '.jpmrc');
  await writeFile(userFile, 'java=17\n');
  for (const marker of ['package.json', '.git']) {
    const root = path.join(cwd, marker === 'package.json' ? 'package-project' : 'git-project');
    const child = path.join(root, 'src', 'main');
    await mkdir(child, { recursive: true });
    await writeFile(path.join(root, marker), marker === 'package.json' ? '{}' : 'gitdir: /unused/worktree');
    assert.equal((await readJavaConfig(child, { homeDir, fallbackVersion: '21' })).projectFile, undefined);
    assert.equal(await writeJavaConfig(child, 25, { homeDir }), path.join(root, '.jpmrc'));
    assert.equal((await readJavaConfig(root, { homeDir, fallbackVersion: '21' })).version, '25');
    await assert.rejects(readFile(path.join(child, '.jpmrc')), { code: 'ENOENT' });
    await writeFile(path.join(child, '.jpmrc'), 'java=21\n');
    assert.equal(await writeJavaConfig(child, 17, { homeDir }), path.join(child, '.jpmrc'));
    assert.equal(await readFile(path.join(root, '.jpmrc'), 'utf8'), 'java=25\n');
  }
  for (const standalone of [path.join(cwd, 'standalone'), path.join(directory, 'outside-home')]) {
    await mkdir(standalone);
    assert.equal(await writeJavaConfig(standalone, 21, { homeDir }), path.join(standalone, '.jpmrc'));
  }
  assert.equal(await readFile(userFile, 'utf8'), 'java=17\n');
});

test('writes the nearest project rc while preserving comments, newlines, and permissions', async t => {
  const { homeDir, cwd } = await fixture(t);
  const file = path.join(cwd, '.jpmrc');
  const child = path.join(cwd, 'src');
  await mkdir(child);
  await writeFile(file, '\uFEFF# project\r\n\r\n java = 21 ; keep this\r\n# trailing\r\n');
  await chmod(file, 0o664);
  assert.equal(await writeJavaConfig(child, 25, { homeDir }), file);
  assert.equal(await readFile(file, 'utf8'), '\uFEFF# project\r\n\r\n java = 25 ; keep this\r\n# trailing\r\n');
  assert.equal((await stat(file)).mode & 0o777, 0o664);
  assert.deepEqual(await readdir(cwd), ['.jpmrc', 'src']);
  await writeFile(file, '# not selected');
  await writeJavaConfig(cwd, 21, { homeDir });
  assert.equal(await readFile(file, 'utf8'), '# not selected\njava=21\n');
});

test('global writes do not touch project config and local writes cannot target home', async t => {
  const { directory, homeDir, cwd } = await fixture(t);
  await writeFile(path.join(cwd, '.jpmrc'), 'java=21\n');
  assert.equal(await writeJavaConfig(cwd, 25, { homeDir, global: true }), path.join(homeDir, '.jpmrc'));
  assert.equal(await readFile(path.join(cwd, '.jpmrc'), 'utf8'), 'java=21\n');
  assert.equal(await readFile(path.join(homeDir, '.jpmrc'), 'utf8'), 'java=25\n');
  await assert.rejects(writeJavaConfig(homeDir, 21, { homeDir }), /--global/);
  const alias = path.join(directory, 'home-alias');
  await symlink(homeDir, alias);
  await assert.rejects(writeJavaConfig(alias, 21, { homeDir }), /--global/);
});

test('refuses malformed configs, invalid versions and symlinks without changing contents', async t => {
  const { homeDir, cwd } = await fixture(t);
  const file = path.join(cwd, '.jpmrc');
  await writeFile(file, 'other=value\n');
  await assert.rejects(writeJavaConfig(cwd, 21, { homeDir }), /unsupported setting/);
  assert.equal(await readFile(file, 'utf8'), 'other=value\n');
  await assert.rejects(writeJavaConfig(cwd, '../21', { homeDir }), /major version/);
  await rm(file);
  const target = path.join(cwd, 'keep');
  await writeFile(target, 'java=17\n');
  await symlink(target, file);
  await assert.rejects(writeJavaConfig(cwd, 21, { homeDir }), /symlinked/);
  assert.equal(await readFile(target, 'utf8'), 'java=17\n');
  assert.deepEqual(await readdir(cwd), ['.jpmrc', 'keep']);
});
