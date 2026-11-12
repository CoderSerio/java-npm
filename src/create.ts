import { errorCode, isRecord } from './validation.js';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as tar from 'tar';
import { syncPom, validateManifest, isScope, type JavaDependency, type JavaConfiguration } from './project.js';
import { readJavaConfig } from './config.js';

interface CreateOptions {
  cwd?: string;
  java?: string;
  boot?: string;
  group?: string;
  packageName?: string;
}

const INITIALIZR = 'https://start.spring.io';
const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_EXPANDED = 16 * 1024 * 1024;
const JAVA_KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _'.split(' '));

function javaPackage(value: unknown) {
  return typeof value === 'string' && value.length <= 160 && value.split('.').every(part => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part) && !JAVA_KEYWORDS.has(part));
}

async function download(url: string, limit: number, accept: string) {
  const response = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': 'jpm/0.1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Spring Initializr returned HTTP ${response.status}. Check the requested Spring Boot and Java versions.`);
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Spring Initializr response exceeds the download limit.');
  }
  if (!response.body) throw new Error('Spring Initializr returned an empty response.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Spring Initializr response exceeds the download limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function dependenciesFromPom(xml: string, expected: Omit<JavaConfiguration, 'dependencies'>) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Spring Initializr returned an invalid POM.');
  const fail = (): never => { throw new Error('The generated POM contains unsupported configuration. jpm supports the standard Spring MVC template only.'); };
  const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : fail();
  const parsed: unknown = new XMLParser({ parseTagValue: false, ignoreAttributes: true }).parse(xml);
  const project = record(record(parsed).project);
  const parent = record(project.parent);
  const properties = record(project.properties);
  if (parent.groupId !== 'org.springframework.boot' || parent.artifactId !== 'spring-boot-starter-parent' || parent.version !== expected.springBoot) fail();
  if (project.groupId !== expected.groupId || project.artifactId !== expected.artifactId || properties['java.version'] !== expected.version) fail();
  for (const field of ['dependencyManagement', 'repositories', 'pluginRepositories', 'profiles', 'modules', 'reporting']) {
    if (project[field] !== undefined) fail();
  }
  if (Object.keys(properties).some(key => key !== 'java.version')) fail();
  const build = record(project.build);
  if (Object.keys(build).some(key => key !== 'plugins')) fail();
  const plugins = [record(build.plugins).plugin].flat().filter(Boolean).map(record);
  if (plugins.length !== 1 || plugins[0].groupId !== 'org.springframework.boot' || plugins[0].artifactId !== 'spring-boot-maven-plugin' || Object.keys(plugins[0]).some(key => !['groupId', 'artifactId'].includes(key))) fail();
  const dependencies: Record<string, JavaDependency> = {};
  for (const dependency of [record(project.dependencies).dependency].flat().filter(Boolean).map(record)) {
    if (Object.keys(dependency).some(key => !['groupId', 'artifactId', 'version', 'scope', 'optional'].includes(key))) fail();
    if (typeof dependency.groupId !== 'string' || typeof dependency.artifactId !== 'string') fail();
    const coordinate = `${dependency.groupId}:${dependency.artifactId}`;
    if (Object.hasOwn(dependencies, coordinate)) fail();
    const value: JavaDependency = {};
    if (dependency.version !== undefined) {
      if (typeof dependency.version !== 'string') return fail();
      value.version = dependency.version;
    }
    if (dependency.scope !== undefined) {
      if (!isScope(dependency.scope)) return fail();
      value.scope = dependency.scope;
    }
    if (dependency.optional !== undefined) {
      if (dependency.optional !== 'true' && dependency.optional !== 'false') fail();
      value.optional = dependency.optional === 'true';
    }
    dependencies[coordinate] = value;
  }
  if (!Object.keys(dependencies).length || typeof project.version !== 'string') return fail();
  validateManifest({ version: project.version, java: { ...expected, dependencies } });
  return { version: project.version, dependencies };
}

async function extractArchive(archive: Buffer, directory: string) {
  // Bound the complete decompressed stream, including headers and padding.
  const unpacked = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED });
  const archiveFile = path.join(directory, 'starter.tar');
  const output = path.join(directory, 'project');
  await writeFile(archiveFile, unpacked, { flag: 'wx' });
  let entries = 0;
  let invalid;
  const seen = new Set();
  await tar.t({
    file: archiveFile,
    strict: true,
    onReadEntry(entry) {
      const normalized = path.posix.normalize(entry.path).replace(/\/$/, '');
      if (++entries > 256 || entry.size > MAX_EXPANDED || !['File', 'OldFile', 'Directory'].includes(entry.type)
          || entry.path.includes('\\') || entry.path.includes('\0') || entry.path.split('/').includes('..')
          || path.posix.isAbsolute(entry.path) || /^[a-zA-Z]:/.test(entry.path)
          || normalized === '..' || normalized.startsWith('../') || seen.has(normalized)) {
        invalid = new Error('Spring Initializr archive contains unsafe or unsupported entries.');
      }
      seen.add(normalized);
    },
  });
  if (invalid) throw invalid;
  if (!entries) throw new Error('Spring Initializr returned an empty archive.');
  await mkdir(output);
  await tar.x({ file: archiveFile, cwd: output, strict: true, preserveOwner: false, filter: (_name, entry) => 'type' in entry && ['File', 'OldFile', 'Directory'].includes(entry.type) });
  for (const required of ['pom.xml', 'mvnw', 'mvnw.cmd', '.mvn/wrapper/maven-wrapper.properties']) {
    if (!(await lstat(path.join(output, required))).isFile()) throw new Error(`Generated project is missing ${required}.`);
  }
  await chmod(path.join(output, 'mvnw'), 0o755);
  return output;
}

function controller(packageName: string) {
  return `package ${packageName};

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HelloController {
    @GetMapping("/")
    public Map<String, String> hello() {
        return Map.of("message", "Hello from jpm!");
    }
}
`;
}

function controllerTest(packageName: string) {
  return `package ${packageName};

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class JpmHelloTests {
    @LocalServerPort
    private int port;

    @Test
    void servesHelloMessage() throws Exception {
        var client = HttpClient.newHttpClient();
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/")).GET().build();
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        assertEquals("{\\"message\\":\\"Hello from jpm!\\"}", response.body());
    }
}
`;
}

export async function createProject(name: string, options: CreateOptions = {}) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 80) throw new Error('Use a project name such as my-app: lowercase letters, numbers, and single hyphens.');
  const groupId = options.group ?? 'com.example';
  const packageName = options.packageName ?? `${groupId}.${name.replaceAll('-', '')}`;
  if (!javaPackage(groupId) || !javaPackage(packageName)) throw new Error('Group and package names must contain valid Java identifiers separated by dots.');
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const javaVersion = String(options.java ?? (await readJavaConfig(cwd)).version ?? '21');
  if (!/^\d+$/.test(javaVersion) || Number(javaVersion) < 17) throw new Error('jpm requires Java 17 or newer.');
  const directory = path.join(cwd, name);
  try {
    await lstat(directory);
    throw new Error(`Destination already exists: ${directory}`);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  const metadata: unknown = JSON.parse((await download(`${INITIALIZR}/`, 2 * 1024 * 1024, 'application/vnd.initializr.v2.3+json')).toString());
  if (!isRecord(metadata) || !isRecord(metadata.bootVersion) || !isRecord(metadata.javaVersion)
    || !Array.isArray(metadata.bootVersion.values) || !Array.isArray(metadata.javaVersion.values)) {
    throw new Error('Spring Initializr returned invalid version metadata.');
  }
  const springBoot = options.boot ?? metadata.bootVersion.default;
  if (typeof springBoot !== 'string' || !metadata.bootVersion?.values?.some((item: unknown) => isRecord(item) && item.id === springBoot)) throw new Error('Select a Spring Boot version supported by Spring Initializr.');
  if (!metadata.javaVersion?.values?.some((item: unknown) => isRecord(item) && item.id === javaVersion)) throw new Error(`Spring Initializr does not support Java ${javaVersion}.`);
  const query = new URLSearchParams({ type: 'maven-project', language: 'java', packaging: 'jar', javaVersion, bootVersion: springBoot, groupId, artifactId: name, name, packageName, dependencies: 'web,devtools' });
  const staging = await mkdtemp(path.join(cwd, '.jpm-create-'));
  let reserved = false;
  try {
    const project = await extractArchive(await download(`${INITIALIZR}/starter.tgz?${query}`, MAX_ARCHIVE, 'application/x-compress'), staging);
    const java = { version: javaVersion, springBoot, groupId, artifactId: name, packageName };
    const parsed = dependenciesFromPom(await readFile(path.join(project, 'pom.xml'), 'utf8'), java);
    const manifest = {
      name, version: parsed.version, private: true,
      scripts: { dev: 'jpm dev', build: 'jpm build', test: 'jpm test' },
      java: { ...java, dependencies: parsed.dependencies },
    };
    await writeFile(path.join(project, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await writeFile(path.join(project, '.jpmrc'), `# JDK used to run Maven. The compile target remains in package.json.\njava=${javaVersion}\n`, { flag: 'wx' });
    await rm(path.join(project, 'pom.xml'));
    await syncPom(project, manifest);
    const relativePackage = packageName.replaceAll('.', '/');
    for (const [relative, content] of [
      [`src/main/java/${relativePackage}/HelloController.java`, controller(packageName)],
      [`src/test/java/${relativePackage}/JpmHelloTests.java`, controllerTest(packageName)],
    ]) {
      const filename = path.join(project, relative);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, content, { flag: 'wx' });
    }
    await writeFile(path.join(project, 'README.md'), `# ${name}\n\nA Spring Boot application created with jpm. Requires jpm on PATH, Node.js 26+ and Java ${javaVersion}.\n\n\`\`\`sh\njpm jdk use ${javaVersion}\njpm install\njpm dev\n# In another terminal:\ncurl http://localhost:8080/\njpm test\njpm build\n\`\`\`\n\nGET / returns \`{"message":"Hello from jpm!"}\`.\n\nEdit Java dependencies in \`package.json\` under \`java.dependencies\`, then run \`jpm install\`. The POM is generated; do not edit it directly.\n\nThe project JDK is selected in \`.jpmrc\` (\`java=${javaVersion}\`). \`package.json.java.version\` remains the compile target. Use \`jpm jdk list\` to see installed JDKs and \`jpm jdk use <major>\` to install a missing JDK and save a project selection. To also switch your current bash/zsh terminal, run \`eval "$(jpm jdk env)"\`.\n\nInstall the CLI with \`npm install --global java-npm@alpha\` before running these commands. Java dependencies are resolved by Maven through jpm; this project does not need npm install, node_modules, or a bundled CLI archive. npm scripts are optional aliases for an already installed jpm.\n`, { flag: 'wx' });
    const ignore = path.join(project, '.gitignore');
    const originalIgnore = await readFile(ignore, 'utf8').catch(error => { if (errorCode(error) === 'ENOENT') return ''; throw error; });
    await writeFile(ignore, `${originalIgnore.trimEnd()}\nnode_modules/\n.jpm/\n`);
    // Exclusive mkdir prevents a late-created destination from being overwritten.
    await mkdir(directory);
    reserved = true;
    for (const entry of await readdir(project)) await rename(path.join(project, entry), path.join(directory, entry));
    return { directory, manifest };
  } catch (error) {
    if (reserved) await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
