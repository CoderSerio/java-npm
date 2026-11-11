import { errorCode, errorMessage, isRecord } from './validation.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink, lstat, chmod } from 'node:fs/promises';
import path from 'node:path';

export interface JavaDependency {
  version?: string;
  scope?: 'compile' | 'runtime' | 'provided' | 'test';
  optional?: boolean;
}
export interface JavaConfiguration {
  version: string | number;
  springBoot: string;
  groupId: string;
  artifactId: string;
  packageName?: string;
  dependencies: Record<string, string | JavaDependency>;
}
export interface ProjectManifest {
  name?: string;
  description?: string;
  version?: string;
  java: JavaConfiguration;
  [key: string]: unknown;
}


const coordinatePattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/;
export function isScope(value: unknown): value is NonNullable<JavaDependency['scope']> {
  return value === 'compile' || value === 'runtime' || value === 'provided' || value === 'test';
}
const javaFields = new Set(['version', 'springBoot', 'groupId', 'artifactId', 'packageName', 'dependencies']);

export function parseDependency(value: string): { coordinate: string; dependency: JavaDependency } {
  const [coordinate, version, ...rest] = value.split('@');
  if (!coordinatePattern.test(coordinate) || rest.length || (version !== undefined && !versionPattern.test(version))) {
    throw new Error('Use Maven coordinates: group:artifact@version (omit @version for a Boot-managed dependency).');
  }
  return { coordinate, dependency: version ? { version } : {} };
}

export function validateManifest(manifest: unknown): ProjectManifest {
  if (!isRecord(manifest)) throw new Error('package.json must contain a java configuration.');
  const java = manifest.java;
  if (!isRecord(java)) throw new Error('package.json must contain a java configuration. Run jpm create <name> first.');
  for (const key of Object.keys(java)) {
    if (!javaFields.has(key)) throw new Error(`Unsupported java setting: ${key}.`);
  }
  if ((typeof java.version !== 'string' && typeof java.version !== 'number') || !/^\d{2}$/.test(String(java.version)) || Number(java.version) < 17) throw new Error('java.version must be a Java major version of 17 or newer.');
  if (typeof java.springBoot !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(java.springBoot)) throw new Error('java.springBoot must be an exact Spring Boot version.');
  if (typeof java.groupId !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(java.groupId)) throw new Error('java.groupId must use dotted Java identifiers, for example com.example.');
  if (typeof java.artifactId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(java.artifactId)) throw new Error('java.artifactId must be a lowercase kebab-case name.');
  if (java.packageName !== undefined && (typeof java.packageName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(java.packageName))) throw new Error('java.packageName must use dotted Java identifiers.');
  if (!isRecord(java.dependencies)) throw new Error('java.dependencies must be an object keyed by Maven coordinates.');
  for (const [coordinate, raw] of Object.entries(java.dependencies)) {
    if (!coordinatePattern.test(coordinate)) throw new Error(`Invalid Maven coordinate: ${coordinate}.`);
    const dep = typeof raw === 'string' ? { version: raw } : raw;
    if (!isRecord(dep)) throw new Error(`Invalid dependency configuration for ${coordinate}.`);
    for (const key of Object.keys(dep)) {
      if (!['version', 'scope', 'optional'].includes(key)) throw new Error(`Unsupported dependency setting: ${coordinate}.${key}.`);
    }
    if (dep.version !== undefined && (typeof dep.version !== 'string' || !versionPattern.test(dep.version))) throw new Error(`Use an exact Maven version for ${coordinate}; npm version ranges are not supported.`);
    if (dep.scope !== undefined && !isScope(dep.scope)) throw new Error(`Unsupported Maven scope for ${coordinate}: ${dep.scope}.`);
    if (dep.optional !== undefined && typeof dep.optional !== 'boolean') throw new Error(`optional must be a boolean for ${coordinate}.`);
  }
  if (manifest.version !== undefined && (typeof manifest.version !== 'string' || !versionPattern.test(manifest.version))) throw new Error('package.json version must be a valid Maven version.');
  for (const field of ['name', 'description']) {
    if (manifest[field] !== undefined && typeof manifest[field] !== 'string') throw new Error(`package.json ${field} must be a string.`);
  }
  return manifest as ProjectManifest;
}

const xml = (value: unknown) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function renderPom(manifest: ProjectManifest) {
  validateManifest(manifest);
  const java = manifest.java;
  const dependencies = Object.entries(java.dependencies).sort(([a], [b]) => a.localeCompare(b)).map(([coordinate, raw]) => {
    const [groupId, artifactId] = coordinate.split(':');
    const dep = typeof raw === 'string' ? { version: raw } : raw;
    const fields = { groupId, artifactId, ...dep };
    return `    <dependency>\n${Object.entries(fields).map(([key, value]) => `      <${key}>${xml(value)}</${key}>`).join('\n')}\n    </dependency>`;
  }).join('\n');
  const body = `<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${xml(java.springBoot)}</version>
    <relativePath/>
  </parent>
  <groupId>${xml(java.groupId)}</groupId>
  <artifactId>${xml(java.artifactId)}</artifactId>
  <version>${xml(manifest.version ?? '0.0.1-SNAPSHOT')}</version>
  <name>${xml(manifest.name ?? java.artifactId)}</name>
  <description>${xml(manifest.description ?? 'Created with jpm')}</description>
  <properties>
    <java.version>${java.version}</java.version>
  </properties>
  <dependencies>
${dependencies}
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by jpm from package.json. Do not edit. sha256:${digest(body)} -->\n${body}`;
}

export async function readProject(cwd: string) {
  try {
    return validateManifest(JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new Error('No package.json here. Run this command from a jpm project directory.');
    if (error instanceof SyntaxError) throw new Error(`Invalid package.json: ${errorMessage(error)}`);
    throw error;
  }
}

async function readManagedPom(cwd: string) {
  const file = path.join(cwd, 'pom.xml');
  try {
    if ((await lstat(file)).isSymbolicLink()) throw Object.assign(new Error('Refusing to overwrite a symlinked pom.xml.'), { code: 'JPM_POM_MODIFIED' });
    const contents = await readFile(file, 'utf8');
    const match = /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!-- Generated by jpm from package.json\. Do not edit\. sha256:([a-f0-9]{64}) -->\n([\s\S]*)$/.exec(contents);
    if (!match || digest(match[2]) !== match[1]) throw Object.assign(new Error('pom.xml contains unmanaged or manual changes. Back it up and remove it before regenerating from package.json.'), { code: 'JPM_POM_MODIFIED' });
    return contents;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

export async function inspectPom(cwd: string, manifest?: ProjectManifest) {
  const expected = renderPom(manifest ?? await readProject(cwd));
  try {
    const current = await readManagedPom(cwd);
    return { status: current === undefined ? 'missing' : current === expected ? 'current' : 'stale' };
  } catch (error) {
    if (errorCode(error) === 'JPM_POM_MODIFIED') return { status: 'modified', detail: errorMessage(error) };
    throw error;
  }
}

async function atomicWrite(file: string, contents: string) {
  const info = await lstat(file).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
  if (info?.isSymbolicLink()) throw new Error(`Refusing to overwrite a symlinked ${path.basename(file)}.`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: info ? info.mode & 0o777 : 0o666 });
    if (info) await chmod(temporary, info.mode & 0o777);
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
  }
}

export async function syncPom(cwd: string, manifest?: ProjectManifest) {
  const rendered = renderPom(manifest ?? await readProject(cwd));
  if (await readManagedPom(cwd) !== rendered) await atomicWrite(path.join(cwd, 'pom.xml'), rendered);
  return rendered;
}

export async function saveProject(cwd: string, manifest: ProjectManifest) {
  const rendered = renderPom(manifest);
  await readManagedPom(cwd);
  const file = path.join(cwd, 'package.json');
  if ((await lstat(file)).isSymbolicLink()) throw new Error('Refusing to overwrite a symlinked package.json.');
  // The manifest is the source of truth; a subsequent sync can recover a failed POM write.
  await atomicWrite(file, `${JSON.stringify(manifest, null, 2)}\n`);
  await atomicWrite(path.join(cwd, 'pom.xml'), rendered);
}
