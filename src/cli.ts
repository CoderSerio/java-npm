import { errorCode, errorMessage, isRecord } from './validation.js';
import { parseArgs } from 'node:util';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createProject } from './create.js';
import { resolveJdk, installJdk, listJdks, listRemoteJdks, majorVersion, shellEnvironment, type Jdk } from './jdk.js';
import { readJavaConfig, writeJavaConfig } from './config.js';
import { runMaven, runDev, wrapperPath } from './maven.js';
import { inspectDoctor } from './doctor.js';
import { readProject, saveProject, syncPom, parseDependency, validateManifest, isScope } from './project.js';
import path from 'node:path';
import { homedir } from 'node:os';
import { banner, choose, cleanText, color, interactive, PromptCancelled, question, terminalOutput } from './terminal.js';

const help = `jpm — a frontend-friendly Java workflow

  jpm                            Open the interactive welcome page
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
  jpm jdk                        List installed JDKs, with the current selection first
  jpm jdk list [major] [-r]       List local JDKs, or available Temurin releases with --remote
  jpm jdk install [major]         Install Temurin without selecting it (alias: jdk i)
  jpm jdk use <major> [--global]  Install if missing, then select in .jpmrc (or ~/.jpmrc)
  jpm jdk env [major]             Print exports for eval "$(jpm jdk env)"

Pass Maven arguments after --, for example jpm build -- -DskipTests.
.jpmrc selects the JDK; package.json java.version remains the compile target.
Requires Node.js 26+. The first release supports macOS and Linux.
`;

async function cliVersion(): Promise<string> {
  return JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
}

async function welcome() {
  let project;
  let problem;
  try {
    const manifest: unknown = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    if (isRecord(manifest) && manifest.java !== undefined) project = validateManifest(manifest);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') problem = errorMessage(error);
  }
  const choices = [
    ...(project ? [
      { label: 'Start development', value: 'dev' },
      { label: 'Run tests', value: 'test' },
    ] : []),
    ...(project || problem ? [{ label: 'Check project', value: 'doctor' }] : []),
    { label: 'Create a Spring project', value: 'create' },
    { label: 'View command guide', value: 'help' },
    { label: 'Exit', value: 'exit' },
  ];
  return choose('What would you like to do?', choices, { header: {
    version: await cliVersion(),
    subtitle: 'A familiar workflow for Java.',
    details: [
      `Node     ${process.versions.node}`,
      `Project  ${project?.java.artifactId ?? (problem ? 'Needs attention' : 'Not selected')}`,
      ...(project ? [`Target   Java ${project.java.version}`, 'Build    Maven Wrapper'] : []),
      ...(problem ? [problem] : []),
    ],
  } });
}

function printDoctor(report: Awaited<ReturnType<typeof inspectDoctor>>, version: string) {
  if (terminalOutput()) {
    const summary = ['Node.js', 'Platform', 'Project', 'JDK', 'Maven Wrapper', 'POM'].flatMap(name => {
      const check = report.checks.find(check => check.name === name);
      if (!check) return [];
      const detail = name === 'Maven Wrapper' ? 'Ready' : name === 'POM' ? 'In sync'
        : name === 'Project' ? check.detail.replace(/ \(.*\)$/, '')
        : name === 'JDK' ? check.detail.split(': ')[0] : check.detail;
      return [`${name.padEnd(14)}${check.status === 'ok' ? detail : check.status.toUpperCase()}`];
    });
    banner(version, 'Project health', summary);
    console.log(color('  Environment checks', 'text'));
    for (const check of report.checks) {
      const status = check.status === 'ok' ? 'OK' : check.status === 'warn' ? 'WARN' : 'ERROR';
      console.log(`\n  ${color(status.padEnd(5), check.status === 'ok' ? 'blue' : 'red')} ${color(cleanText(check.name), 'text')}`);
      console.log(`        ${cleanText(check.detail)}`);
      if (check.action) console.log(`        ${color('Next:', 'blue')} ${cleanText(check.action)}`);
    }
    const count = (status: string) => report.checks.filter(check => check.status === status).length;
    console.log(`\n  ${count('ok')} passed · ${count('warn')} warning${count('warn') === 1 ? '' : 's'} · ${count('error')} error${count('error') === 1 ? '' : 's'}`);
    console.log(`  ${report.ok ? 'Project checks passed.' : 'Resolve the errors above, then run jpm doctor again.'}\n`);
  } else {
    for (const check of report.checks) {
      console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
      if (check.action) console.log(`  Next: ${check.action}`);
    }
    console.log(report.ok ? 'Project checks passed.' : 'Resolve the errors above, then run jpm doctor again.');
  }
}

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

async function showJdks(cwd: string, major?: number, remote = false) {
  const releases = remote ? await listRemoteJdks(major) : undefined;
  const installed = await listJdks();
  let current: Jdk | undefined;
  let source: string | undefined;
  let selectionError: string | undefined;
  try {
    const config = await readJavaConfig(cwd, { fallbackVersion: await compileTarget(cwd) });
    source = config.source;
    if (config.version) current = await resolveJdk(config.version);
  } catch (error) {
    selectionError = errorMessage(error);
  }
  if (releases) {
    const matches = (jdk: Jdk, release: typeof releases[number]) => jdk.distribution === release.distribution && jdk.runtimeVersion === release.runtimeVersion && jdk.architecture === release.architecture;
    const ordered = releases.toSorted((a, b) => Number(Boolean(current && matches(current, b))) - Number(Boolean(current && matches(current, a))));
    console.log(`Available Temurin JDKs · ${process.platform}/${process.arch} · ${major ? `Java ${major} release history` : 'latest release per major'}:`);
    for (const release of ordered) {
      const selected = Boolean(current && matches(current, release));
      const status = selected ? 'current' : installed.some(jdk => matches(jdk, release)) ? 'installed' : 'available';
      const label = `${selected ? '*' : ' '} ${release.runtimeVersion.padEnd(20)} Temurin  ${status}`;
      console.log(selected ? color(label, 'blue') : label);
    }
    if (!ordered.length) console.log('No matching releases are available for this platform.');
    console.log('\nGA releases only. Install with jpm jdk i <major>; select with jpm jdk use <major>.\nExisting cached JDKs are reused. Exact patch selection is not supported yet.');
    if (selectionError) console.error(`jpm: Current selection could not be resolved: ${cleanText(selectionError)}`);
    return 0;
  }
  const matching = installed.filter(jdk => major === undefined || jdk.version === major);
  const selected = current && (major === undefined || current.version === major) ? current : undefined;
  const ordered = selected ? [selected, ...matching.filter(jdk => jdk.home !== selected.home)] : matching;
  console.log(ordered.length ? 'Installed JDKs (current = selected for jpm):' : `No installed ${major ? `Java ${major} JDKs` : 'JDKs'} found. Use jpm jdk use ${major ?? '<major>'}.`);
  for (const jdk of ordered) {
    const selected = jdk.home === current?.home;
    const label = `${selected ? '*' : ' '} Java ${jdk.version}${selected ? ' (current)' : ''}`;
    const details = jdk.runtimeVersion ? `${cleanText(jdk.runtimeVersion)}${jdk.distribution ? ' Temurin' : ''}\t` : '';
    console.log(`${selected ? color(label, 'blue') : label}\t${details}${cleanText(jdk.home)}`);
  }
  if (current && !selected) console.log(`\nCurrent selection: Java ${current.version} (outside this filter).`);
  if (source) console.log(`\nSelected by ${cleanText(source)}.`);
  if (selectionError) {
    console.error(`jpm: ${cleanText(selectionError)}`);
    return 1;
  }
  if (!current && ordered.length) console.log('\nNo JDK selected for jpm. Use jpm jdk use <major> to install if needed and select it.');
  return 0;
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
  const wizard = interactive() && !values.yes;
  if (wizard) {
    banner(await cliVersion(), 'Create a Spring application', ['Spring MVC · Maven Wrapper', 'No tools or dependencies are installed during creation.']);
    if (!name) name = await question('Project name', 'my-app', value =>
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80
        ? undefined : 'Use lowercase letters, numbers, and single hyphens (for example my-app).');
    console.log(`  ${color('✓', 'blue')} Project name  ${cleanText(name)}`);
    if (!java) {
      const installed = [...new Set((await listJdks()).map(jdk => String(jdk.version)))].filter(version => Number(version) >= 17);
      const versions = [...new Set([defaultJava, ...installed])];
      java = await choose('Java compile target', [
        ...versions.map(version => ({ value: version, label: `Java ${version}${version === defaultJava ? ' (default)' : ''} — ${installed.includes(version) ? 'Installed' : 'Not installed'}` })),
        { label: 'Choose another version', value: 'custom' },
      ]);
      if (java === 'custom') java = await question('Java major version', defaultJava, value =>
        /^\d{2}$/.test(value) && Number(value) >= 17 ? undefined : 'Enter a Java major version from 17 to 99.');
      console.log(`  ${color('✓', 'blue')} Java target   ${java}`);
    }
  }
  if (!name) throw new Error('Provide a project name: jpm create my-app --java 21');
  console.log(wizard ? `\n  ${color('›', 'blue')} Creating ${cleanText(name)} from Spring Initializr…` : `Creating ${name} from Spring Initializr…`);
  java ??= defaultJava;
  const result = await createProject(name, { java, boot: values.boot, group: values.group, packageName: values['package-name'] });
  if (wizard) {
    console.log(`\n  ${color('✓', 'blue')} Created ${cleanText(result.directory)}\n\n  ${color('Next steps', 'text')}\n\n    cd ${name}\n    jpm jdk use ${java}\n    jpm install\n    jpm dev\n\n  After the application starts, open http://localhost:8080.\n  jdk use downloads Temurin only if a matching local JDK is missing.\n`);
  } else console.log(`\nCreated ${result.directory}\n\n  cd ${name}\n  jpm jdk use ${java}\n  jpm install\n  jpm dev\n\nThen open http://localhost:8080. jdk use downloads Temurin only if a matching local JDK is missing.`);
}

export async function main(args = process.argv.slice(2)) {
  let [command, ...rest] = args;
  if (!command && interactive()) {
    command = await welcome();
    if (command === 'exit') return 0;
  }
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help); return 0; }
  if (command === '--version' || command === '-v') {
    console.log(await cliVersion());
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
    else printDoctor(report, await cliVersion());
    return report.ok ? 0 : 1;
  }
  if (command === 'run') {
    [command, ...rest] = rest;
    if (!['dev', 'build', 'test'].includes(command)) throw new Error('Usage: jpm run <dev|build|test>.');
  }
  const cwd = process.cwd();
  if (command === 'jdk') {
    const [action, ...jdkArgs] = rest;
    if (rest.length === 0) return showJdks(cwd);
    if (action === 'list') {
      const { values, positionals } = parseArgs({ args: jdkArgs, allowPositionals: true, options: { remote: { type: 'boolean', short: 'r' } } });
      if (positionals.length > 1) throw new Error('Usage: jpm jdk list [major] [--remote|-r]');
      return showJdks(cwd, positionals.length ? majorVersion(positionals[0]) : undefined, values.remote);
    }
    if (action === 'use') {
      const { values, positionals } = parseArgs({ args: jdkArgs, allowPositionals: true, options: { global: { type: 'boolean' } } });
      if (positionals.length !== 1) throw new Error('Usage: jpm jdk use <major> [--global]');
      const major = majorVersion(positionals[0]);
      if (!values.global) requireCompatibleJdk(major, await compileTarget(cwd));
      const jdk = await resolveJdk(major, { installIfMissing: true, onInstall: () => console.log(`JDK ${major} is not installed. Downloading Temurin ${major}…`) });
      const file = await writeJavaConfig(cwd, jdk.version, { global: values.global });
      console.log(`Saved Java ${jdk.version} in ${file}.\nJDK: ${jdk.home}\nTo switch this terminal too, run: eval "$(jpm jdk env${values.global ? ` ${jdk.version}` : ''})"`);
    } else if (['env', 'install', 'i'].includes(action) && jdkArgs.length <= 1) {
      const { version } = await configuredJava(cwd, jdkArgs[0]);
      if (action === 'env') console.log(shellEnvironment(await resolveJdk(version)));
      else {
        console.log(`Preparing Temurin JDK ${version}…`);
        const jdk = await installJdk(version);
        console.log(`JDK ${jdk.version}: ${jdk.home}\nSelection unchanged. To select it, run: jpm jdk use ${jdk.version}`);
      }
    } else throw new Error('Usage: jpm jdk [list [major] [--remote|-r] | install|i [major] | use <major> [--global] | env [major]]');
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
    if (error instanceof PromptCancelled) {
      console.error('jpm: Cancelled.');
      process.exitCode = error.exitCode;
      return;
    }
    console.error(`jpm: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
