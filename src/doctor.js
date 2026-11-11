import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { readJavaConfig } from './config.js';
import { resolveJdk } from './jdk.js';
import { inspectPom, readProject } from './project.js';

async function pathJava(env, cwd) {
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    const file = path.resolve(cwd, directory, 'java');
    try {
      if (!(await stat(file)).isFile()) continue;
      await access(file, constants.X_OK);
      return realpath(file);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  return undefined;
}

export async function inspectDoctor(cwd, options = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const checks = [];
  const add = (name, status, detail, action) => checks.push({ name, status, detail, ...(action ? { action } : {}) });

  const nodeMajor = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  add('Node.js', nodeMajor >= 22 ? 'ok' : 'error', String(nodeVersion), nodeMajor >= 22 ? undefined : 'Install Node.js 22 or newer.');
  const supportedPlatform = ['darwin', 'linux'].includes(platform);
  add('Platform', supportedPlatform ? 'ok' : 'error', platform, supportedPlatform ? undefined : 'Run jpm on macOS or Linux; Windows is not supported yet.');

  let manifest;
  try {
    manifest = await readProject(cwd);
    add('Project', 'ok', `${manifest.java.groupId}:${manifest.java.artifactId} (${path.resolve(cwd)})`);
  } catch (error) {
    add('Project', 'error', error.message, 'Run jpm doctor from the project root and correct its package.json.');
  }

  let configuration;
  try {
    configuration = await readJavaConfig(cwd, { homeDir, fallbackVersion: manifest?.java.version });
    if (configuration.version) add('Java configuration', 'ok', `JDK ${configuration.version}, selected by ${configuration.source}.`);
    else add('Java configuration', 'error', 'No Java version is configured.', 'Use jpm jdk use <major>, or set java=<major> in .jpmrc.');
  } catch (error) {
    add('Java configuration', 'error', error.message, 'Correct the reported .jpmrc configuration.');
  }

  if (manifest && configuration?.version) {
    const compatible = Number(configuration.version) >= Number(manifest.java.version);
    add('Compile target', compatible ? 'ok' : 'error', `Java ${manifest.java.version} target, JDK ${configuration.version} selected.`,
      compatible ? undefined : `Run jpm jdk use ${manifest.java.version} (or a newer installed JDK).`);
  }

  if (configuration?.version && supportedPlatform) {
    let jdk;
    try {
      jdk = await resolveJdk(configuration.version, { env, homeDir, platform });
      add('JDK', 'ok', `Java ${jdk.version}: ${jdk.home}`);
    } catch (error) {
      add('JDK', 'error', error.message, `Run jpm jdk install ${configuration.version}, or set JAVA_HOME to that installed JDK.`);
    }
    if (jdk) {
      try {
        const terminalHome = env.JAVA_HOME ? await realpath(env.JAVA_HOME).catch(() => env.JAVA_HOME) : undefined;
        const executable = await pathJava(env, cwd);
        const selectedExecutable = await realpath(path.join(jdk.home, 'bin', 'java'));
        const matches = terminalHome === jdk.home && executable === selectedExecutable;
        add('Shell environment', matches ? 'ok' : 'warn', matches
          ? 'JAVA_HOME and PATH select the same JDK as jpm.'
          : `jpm uses ${jdk.home}; JAVA_HOME is ${env.JAVA_HOME ?? 'unset'} and PATH Java is ${executable ?? 'not found'}.`,
        matches ? undefined : 'To switch this terminal too, run: eval "$(jpm jdk env)"');
      } catch (error) {
        add('Shell environment', 'warn', `Could not inspect the shell environment: ${error.message}`, 'Review JAVA_HOME and PATH, then rerun jpm doctor.');
      }
    }
  }

  const wrapperProblems = [];
  const wrapper = path.join(cwd, 'mvnw');
  try {
    if (!(await stat(wrapper)).isFile()) throw new Error('not a file');
    await access(wrapper, constants.X_OK);
  } catch (error) {
    wrapperProblems.push(error.code === 'ENOENT' ? 'mvnw is missing' : 'mvnw is not an executable file');
  }
  const wrapperProperties = path.join(cwd, '.mvn', 'wrapper', 'maven-wrapper.properties');
  try {
    const properties = await readFile(wrapperProperties, 'utf8');
    if (!/^\s*distributionUrl\s*=\s*\S+/m.test(properties)) wrapperProblems.push('maven-wrapper.properties has no distributionUrl');
  } catch (error) {
    wrapperProblems.push(error.code === 'ENOENT' ? 'maven-wrapper.properties is missing' : `Cannot read maven-wrapper.properties: ${error.message}`);
  }
  add('Maven Wrapper', wrapperProblems.length ? 'error' : 'ok', wrapperProblems.length ? wrapperProblems.join('; ') : 'mvnw and its distribution configuration are present.',
    wrapperProblems.length ? 'Restore the project Maven Wrapper files; if mvnw exists, make it executable with chmod +x mvnw.' : undefined);

  if (manifest) {
    try {
      const pom = await inspectPom(cwd, manifest);
      if (pom.status === 'current') add('POM', 'ok', 'pom.xml matches package.json.');
      else if (pom.status === 'missing' || pom.status === 'stale') add('POM', 'error', pom.status === 'missing' ? 'pom.xml is missing.' : 'pom.xml is out of date with package.json.', 'Run jpm sync.');
      else add('POM', 'error', pom.detail ?? 'pom.xml contains manual or unmanaged changes.', 'Back up and review pom.xml before removing it and running jpm sync.');
    } catch (error) {
      add('POM', 'error', error.message, 'Check access to pom.xml and review the project configuration.');
    }
  } else add('POM', 'warn', 'POM comparison requires a valid project manifest.', 'Correct package.json, then rerun jpm doctor.');

  return { ok: checks.every(check => check.status !== 'error'), checks };
}
