import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import * as tar from 'tar';
import { createProject } from '../src/create.js';

const metadata = {
  bootVersion: { default: '4.1.2', values: [{ id: '4.1.2' }] },
  javaVersion: { default: '17', values: [{ id: '17' }, { id: '21' }] },
};
const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project><modelVersion>4.0.0</modelVersion>
<parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.1.2</version><relativePath/></parent>
<groupId>com.example</groupId><artifactId>demo</artifactId><version>0.0.1-SNAPSHOT</version>
<properties><java.version>21</java.version></properties>
<dependencies>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-webmvc</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-devtools</artifactId><scope>runtime</scope><optional>true</optional></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-webmvc-test</artifactId><scope>test</scope></dependency>
</dependencies>
<build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build>
</project>`;

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jpm-create-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function archive(t, { xml = pom, unsafeLink = false, prefix } = {}) {
  const directory = await workspace(t);
  const files = {
    'pom.xml': xml,
    mvnw: '#!/bin/sh\nexit 0\n',
    'mvnw.cmd': '@echo off\n',
    '.mvn/wrapper/maven-wrapper.properties': 'distributionUrl=https://example.com/maven.zip\n',
    'src/main/java/com/example/demo/DemoApplication.java': 'package com.example.demo;\n',
    'src/test/java/com/example/demo/DemoApplicationTests.java': 'package com.example.demo;\n',
    '.gitignore': 'target/\n',
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), content);
  }
  if (unsafeLink) {
    await symlink('/tmp', path.join(directory, 'escape'));
    files.escape = '';
  }
  const chunks = [];
  for await (const chunk of tar.c({ cwd: directory, gzip: true, portable: true, prefix }, Object.keys(files))) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function mockInitializr(t, body, onRequest = () => {}) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    onRequest(new URL(url), options);
    return new URL(url).pathname === '/'
      ? Response.json(metadata)
      : new Response(body, { headers: { 'content-type': 'application/x-compress' } });
  });
}

test('create preserves official dependencies and wrappers and supplies a runnable endpoint', async t => {
  const cwd = await workspace(t);
  const requests = [];
  mockInitializr(t, await archive(t), (url, options) => requests.push({ url, options }));
  const { directory, manifest } = await createProject('demo', { cwd });
  assert.equal(directory, path.join(cwd, 'demo'));
  assert.equal(manifest.java.version, '21');
  assert.match(await readFile(path.join(directory, '.jpmrc'), 'utf8'), /^java=21$/m);
  assert.equal(manifest.java.springBoot, '4.1.2');
  assert.deepEqual(manifest.java.dependencies['org.springframework.boot:spring-boot-devtools'], { scope: 'runtime', optional: true });
  assert.deepEqual(manifest.java.dependencies['org.springframework.boot:spring-boot-starter-webmvc-test'], { scope: 'test' });
  assert.equal(requests[0].options.headers.Accept, 'application/vnd.initializr.v2.3+json');
  assert.equal(requests[1].url.pathname, '/starter.tgz');
  assert.equal(requests[1].options.headers.Accept, 'application/x-compress');
  assert.equal(requests[1].url.searchParams.get('dependencies'), 'web,devtools');
  assert.equal(requests[1].url.searchParams.get('bootVersion'), '4.1.2');
  assert.equal((JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))).scripts.postinstall, undefined);
  assert.match(manifest.devDependencies['java-npm'], /^file:vendor\/java-npm-[\w.+-]+\.tgz$/);
  assert.equal(manifest.devDependencies['create-jpm'], undefined);
  const bundledCli = path.join(directory, manifest.devDependencies['java-npm'].slice('file:'.length));
  const packedFiles = [];
  await tar.t({ file: bundledCli, onReadEntry: entry => packedFiles.push(entry.path) });
  assert.ok(packedFiles.includes('package/bin/jpm.js'));
  assert.ok(packedFiles.includes('package/src/config.js'));
  const sourceDirectory = fileURLToPath(new URL('../', import.meta.url));
  assert.ok(!JSON.stringify(manifest).includes(sourceDirectory));
  assert.match(await readFile(path.join(directory, '.gitignore'), 'utf8'), /!vendor\/java-npm-.*\.tgz/);
  const readme = await readFile(path.join(directory, 'README.md'), 'utf8');
  assert.match(readme, /relative dependency survives moving/);
  assert.ok(!readme.includes(sourceDirectory));
  assert.match(await readFile(path.join(directory, 'pom.xml'), 'utf8'), /spring-boot-starter-webmvc-test/);
  assert.match(await readFile(path.join(directory, 'src/main/java/com/example/demo/HelloController.java'), 'utf8'), /Hello from jpm!/);
  assert.match(await readFile(path.join(directory, 'src/test/java/com/example/demo/JpmHelloTests.java'), 'utf8'), /assertEquals\(200, response.statusCode\(\)\)/);
  assert.equal(await readFile(path.join(directory, 'mvnw'), 'utf8'), '#!/bin/sh\nexit 0\n');
  assert.deepEqual(await readdir(cwd), ['demo']);
});

test('create uses the configured JDK default and an explicit Java version wins', async t => {
  const cwd = await workspace(t);
  await writeFile(path.join(cwd, '.jpmrc'), 'java=17\n');
  mockInitializr(t, await archive(t, { xml: pom.replace('<java.version>21</java.version>', '<java.version>17</java.version>') }));
  const first = await createProject('demo', { cwd });
  assert.equal(first.manifest.java.version, '17');
  assert.match(await readFile(path.join(first.directory, '.jpmrc'), 'utf8'), /^java=17$/m);
  t.mock.restoreAll();
  await rm(first.directory, { recursive: true });
  mockInitializr(t, await archive(t));
  assert.equal((await createProject('demo', { cwd, java: '21' })).manifest.java.version, '21');
});

test('create rejects invalid names and Java packages before making requests', async t => {
  const cwd = await workspace(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network access'); });
  for (const name of ['../demo', '/tmp/demo', 'Demo', 'a/b', 'a--b', 'demo;echo', '']) {
    await assert.rejects(createProject(name, { cwd }), /project name/);
  }
  for (const packageName of ['com.class', '../escape', 'com.example;']) {
    await assert.rejects(createProject('demo', { cwd, packageName }), /Java identifiers/);
  }
  await assert.rejects(createProject('demo', { cwd, java: '11' }), /Java 17/);
  assert.deepEqual(await readdir(cwd), []);
});

test('create rejects existing destinations without changing their files', async t => {
  const cwd = await workspace(t);
  await mkdir(path.join(cwd, 'demo'));
  await writeFile(path.join(cwd, 'demo', 'mine.txt'), 'keep');
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network access'); });
  await assert.rejects(createProject('demo', { cwd }), /already exists/);
  assert.equal(await readFile(path.join(cwd, 'demo', 'mine.txt'), 'utf8'), 'keep');
});

test('create cleans staging after failed downloads', async t => {
  const cwd = await workspace(t);
  t.mock.method(globalThis, 'fetch', async url => new URL(url).pathname === '/' ? Response.json(metadata) : new Response('unavailable', { status: 503 }));
  await assert.rejects(createProject('demo', { cwd }), /HTTP 503/);
  assert.deepEqual(await readdir(cwd), []);
});

test('create rejects links and archive path traversal before extracting', async t => {
  for (const options of [{ unsafeLink: true }, { prefix: '../outside' }]) {
    const cwd = await workspace(t);
    mockInitializr(t, await archive(t, options));
    await assert.rejects(createProject('demo', { cwd }), /unsafe|unsupported/);
    assert.deepEqual(await readdir(cwd), []);
    t.mock.restoreAll();
  }
});

test('create rejects decompression bombs and unsupported POM configuration', async t => {
  const cwd = await workspace(t);
  mockInitializr(t, gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1)));
  await assert.rejects(createProject('demo', { cwd }), /larger than|output|buffer/i);
  assert.deepEqual(await readdir(cwd), []);
  t.mock.restoreAll();
  mockInitializr(t, await archive(t, { xml: pom.replace('</project>', '<dependencyManagement><dependencies/></dependencyManagement></project>') }));
  await assert.rejects(createProject('demo', { cwd }), /unsupported configuration/);
  assert.deepEqual(await readdir(cwd), []);
});
