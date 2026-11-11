import { errorCode, errorMessage, isRecord } from './validation.js';
import { parseArgs } from 'node:util';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createProject } from './create.js';
import { resolveJdk, installJdk, listJdks, shellEnvironment } from './jdk.js';
import { readJavaConfig, writeJavaConfig } from './config.js';
import { runMaven, runDev, wrapperPath } from './maven.js';
import { inspectDoctor } from './doctor.js';
import { readProject, saveProject, syncPom, parseDependency, validateManifest, isScope } from './project.js';
import path from 'node:path';
import { homedir } from 'node:os';

const help = `jpm — a frontend-friendly Java workflow

  jpm create <name> [--java 21] [--boot <version>] [--group com.example] [-y]
  jpm doctor [--json]             Inspect the project and environment without changing files
  jpm install                    Resolve Java dependencies with Maven Wrapper
  jpm add <group:artifact[@version]> [--scope test] [--optional]
  jpm remove <group:artifact>     Remove a Java dependency
  jpm list [--json]               Show declared Java dependencies without resolving them
  jpm tree [-- <Maven args>]      Show the resolved Maven dependency tree
  jpm sync                       Generate pom.xml from package.json
  jpm dev                        Watch, compile, and restart the Spring app
  jpm build                      Test and package an executable JAR
  jpm test                       Run Java tests
  jpm run <dev|build|test>        Aliases for the commands above
  jpm jdk                        Show the selected project JDK
  jpm jdk list                   List installed JDKs
  jpm jdk install [major]         Install a verified Temurin JDK locally
  jpm jdk use <major> [--global]  Save the JDK in .jpmrc (or ~/.jpmrc)
  jpm jdk env [major]             Print exports for eval "$(jpm jdk env)"

Pass Maven arguments after --, for example jpm build -- -DskipTests.
.jpmrc selects the JDK; package.json java.version remains the compile target.
Requires Node.js 26+. The first release supports macOS and Linux.
`;

async function compileTarget(cwd: string) {
  const userDirectory = await realpath(homedir());
  for (let directory = await realpath(cwd); ; directory = path.dirname(directory)) {
    try {
      const manifest: unknown = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      return isRecord(manifest) && manifest.java ? validateManifest(manifest).java.version : undefined;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Invalid package.json in ${directory}: ${errorMessage(error)}`);
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    if (directory === userDirectory || path.dirname(directory) === directory) return undefined;
    const repository = await lstat(path.join(directory, '.git')).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; });
    if (repository) return undefined;
  }
}

async function configuredJava(cwd: string, explicit?: string) {
  if (explicit !== undefined) return { version: explicit, source: 'command line' };
  const config = await readJavaConfig(cwd, { fallbackVersion: await compileTarget(cwd) });
  if (!config.version) throw new Error('No Java version is configured. Use jpm jdk use <major> [--global], or supply a version.');
  return { ...config, version: config.version };
}

function requireCompatibleJdk(version: string | number | undefined, target: string | number | undefined) {
  if (target !== undefined && Number(version) < Number(target)) throw new Error(`JDK ${version} cannot build this project's Java ${target} target. Select JDK ${target} or newer in .jpmrc; package.json java.version controls the compile target.`);
}

async function create(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    java: { type: 'string' }, boot: { type: 'string' }, group: { type: 'string' },
    'package-name': { type: 'string' }, template: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
  } });
  if (positionals.length > 1) throw new Error('Usage: jpm create <name> [--java 21] [-y]');
  if (values.template && values.template !== 'spring') throw new Error('The supported template is spring (Spring MVC).');
  let name = positionals[0];
  let java = values.java;
  const defaultJava = java ?? (await readJavaConfig(process.cwd())).version ?? '21';
  if (stdin.isTTY && !values.yes && (!name || !java)) {
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      if (!name) name = (await prompt.question('Project name (my-app): ')).trim() || 'my-app';
      if (!java) java = (await prompt.question(`Java major version (${defaultJava}): `)).trim() || defaultJava;
    } finally { prompt.close(); }
  }
  if (!name) throw new Error('Provide a project name: jpm create my-app --java 21');
  console.log(`Creating ${name} from Spring Initializr…`);
  java ??= defaultJava;
  const result = await createProject(name, { java, boot: values.boot, group: values.group, packageName: values['package-name'] });
  console.log(`\nCreated ${result.directory}\n\n  cd ${name}\n  jpm install\n  jpm dev\n\nThen open http://localhost:8080. If jpm install reports a missing JDK, run jpm jdk install ${java}, then retry jpm install.`);
}

export async function main(args = process.argv.slice(2)) {
  let [command, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help); return 0; }
  if (command === '--version' || command === '-v') {
    console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
    return 0;
  }
  const ownArgs = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
  if (ownArgs.includes('--help') || ownArgs.includes('-h')) { console.log(help); return 0; }
  if (command === 'create') { await create(rest); return 0; }
  if (command === 'doctor') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { json: { type: 'boolean' } } });
    if (positionals.length) throw new Error('Usage: jpm doctor [--json]');
    const report = await inspectDoctor(process.cwd());
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const check of report.checks) {
        console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
        if (check.action) console.log(`  Next: ${check.action}`);
      }
      console.log(report.ok ? 'Project checks passed.' : 'Resolve the errors above, then run jpm doctor again.');
    }
    return report.ok ? 0 : 1;
  }
  if (command === 'run') {
    [command, ...rest] = rest;
    if (!['dev', 'build', 'test'].includes(command)) throw new Error('Usage: jpm run <dev|build|test>.');
  }
  const cwd = process.cwd();
  if (command === 'jdk') {
    const [action, ...jdkArgs] = rest;
    if (action === 'list' && jdkArgs.length === 0) {
      const installed = await listJdks();
      console.log(installed.length ? installed.map(jdk => `Java ${jdk.version}\t${jdk.home}`).join('\n') : 'No installed JDKs found. Use jpm jdk install <major>.');
    } else if (action === 'use') {
      const { values, positionals } = parseArgs({ args: jdkArgs, allowPositionals: true, options: { global: { type: 'boolean' } } });
      if (positionals.length !== 1) throw new Error('Usage: jpm jdk use <major> [--global]');
      const jdk = await resolveJdk(positionals[0]);
      if (!values.global) requireCompatibleJdk(jdk.version, await compileTarget(cwd));
      const file = await writeJavaConfig(cwd, jdk.version, { global: values.global });
      console.log(`Saved Java ${jdk.version} in ${file}.\nJDK: ${jdk.home}\nTo switch this terminal too, run: eval "$(jpm jdk env${values.global ? ` ${jdk.version}` : ''})"`);
    } else if ((action === 'env' || action === 'install') && jdkArgs.length <= 1) {
      const { version } = await configuredJava(cwd, jdkArgs[0]);
      if (action === 'env') console.log(shellEnvironment(await resolveJdk(version)));
      else {
        console.log(`Preparing Temurin JDK ${version}…`);
        const jdk = await installJdk(version);
        console.log(`JDK ${jdk.version}: ${jdk.home}`);
      }
    } else if (rest.length === 0) {
      const { version, source } = await configuredJava(cwd);
      const jdk = await resolveJdk(version);
      console.log(`JDK ${jdk.version}: ${jdk.home}\nSelected by ${source}.`);
    } else throw new Error('Usage: jpm jdk [list | install [major] | use <major> [--global] | env [major]]');
    return 0;
  }
  if (!['install', 'add', 'remove', 'list', 'tree', 'sync', 'dev', 'build', 'test'].includes(command)) throw new Error(`Unknown command: ${command}. Run jpm --help.`);
  const manifest = await readProject(cwd);
  if (command === 'list') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { json: { type: 'boolean' } } });
    if (positionals.length) throw new Error('Usage: jpm list [--json]');
    const dependencies = Object.entries(manifest.java.dependencies).sort(([a], [b]) => a.localeCompare(b)).map(([coordinate, raw]) => {
      const dependency = typeof raw === 'string' ? { version: raw } : raw;
      return { coordinate, version: dependency.version ?? null, scope: dependency.scope ?? 'compile', optional: dependency.optional ?? false };
    });
    if (values.json) console.log(JSON.stringify({ dependencies }, null, 2));
    else {
      console.log(dependencies.length ? 'Declared Java dependencies (package.json):' : 'No direct Java dependencies declared.');
      for (const dependency of dependencies) {
        console.log(`${dependency.coordinate}\t${dependency.version ?? 'managed by Spring Boot'}\t${dependency.scope}${dependency.optional ? '\toptional' : ''}`);
      }
    }
    return 0;
  }
  let added;
  if (command === 'add') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { scope: { type: 'string' }, optional: { type: 'boolean' } } });
    if (positionals.length !== 1) throw new Error('Usage: jpm add <group:artifact[@version]> [--scope test] [--optional]');
    const { coordinate, dependency } = parseDependency(positionals[0]);
    const existing = manifest.java.dependencies[coordinate];
    if (values.scope) {
      if (!isScope(values.scope)) throw new Error(`Unsupported Maven scope: ${values.scope}.`);
      dependency.scope = values.scope;
    }
    if (values.optional) dependency.optional = true;
    manifest.java.dependencies[coordinate] = { ...(typeof existing === 'string' ? { version: existing } : existing), ...dependency };
    validateManifest(manifest);
    added = coordinate;
    command = 'install';
    rest = [];
  }
  if (command === 'remove') {
    if (rest.length !== 1 || rest[0].includes('@')) throw new Error('Usage: jpm remove <group:artifact>');
    const { coordinate } = parseDependency(rest[0]);
    if (!Object.hasOwn(manifest.java.dependencies, coordinate)) throw new Error(`${coordinate} is not a direct Java dependency.`);
    delete manifest.java.dependencies[coordinate];
    await saveProject(cwd, manifest);
    console.log(`Removed ${coordinate}.`);
    return 0;
  }
  if (command === 'sync') {
    if (rest.length) throw new Error('Usage: jpm sync');
    await syncPom(cwd, manifest);
    console.log('pom.xml is up to date.');
    return 0;
  }
  if (rest.length && rest[0] !== '--') throw new Error('Pass Maven arguments after --, for example jpm build -- -DskipTests.');
  const forwarded = rest.slice(1);
  const { version } = await readJavaConfig(cwd, { fallbackVersion: manifest.java.version });
  requireCompatibleJdk(version, manifest.java.version);
  const jdk = await resolveJdk(version);
  if (added) {
    await wrapperPath(cwd);
    await saveProject(cwd, manifest);
    console.log(`Added ${added}. Resolving Java dependencies…`);
  } else await syncPom(cwd, manifest);
  if (command === 'dev') {
    if (!Object.hasOwn(manifest.java.dependencies, 'org.springframework.boot:spring-boot-devtools')) throw new Error('jpm dev requires org.springframework.boot:spring-boot-devtools. Add it with jpm add org.springframework.boot:spring-boot-devtools --optional.');
    return runDev(cwd, { env: jdk.env, args: forwarded });
  }
  const goals: Record<string, string> = { install: 'dependency:go-offline', tree: 'dependency:tree', build: 'package', test: 'test' };
  const goal = goals[command];
  if (!goal) throw new Error(`Unknown Maven command: ${command}.`);
  let code;
  try { code = await runMaven(cwd, [goal, ...forwarded], { env: jdk.env }); }
  finally {
    if (added && code !== 0) console.error(`jpm: ${added} remains saved in package.json and pom.xml, but dependency resolution did not complete. Fix the Maven error and retry jpm install, or remove it with jpm remove ${added}.`);
  }
  return code;
}

export async function entry(args: string[]) {
  try { process.exitCode = await main(args); }
  catch (error) {
    console.error(`jpm: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
