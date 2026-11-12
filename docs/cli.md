# CLI reference

The npm package `java-npm` installs the `jpm` command. Use `jpm --help` and `jpm --version` to inspect the installed CLI. Node 26+ and macOS/Linux are required.

Unless noted otherwise, project commands run from the directory containing the project's `package.json` and `mvnw`.

## Interactive terminal

Run `jpm` without arguments to open the welcome menu. Outside a valid jpm project, it offers project creation, the command guide, and exit. In a valid project, it also offers development, tests, and diagnostics. Use the arrow keys to move and Enter to select; an action starts only after selection.

The welcome page, creation wizard, and doctor share a coffee mark with red-orange steam and a blue cup. Roomy terminals show the mark beside a thin, rounded frame containing the version, introduction, and environment summary; menus sit below the frame. The default welcome page aligns the right column with the top and bottom of the mark. Small terminals use a compact layout. Solid Unicode half-block characters keep the mark legible without a special font or image download. Text and borders use the terminal's normal foreground instead of bold or dim styling; accents adapt to truecolor, 256-color, or 16-color terminals. The terminal still controls the actual font and theme.

Interactive prompts require both input and output to be terminals. Pipes, redirected output, CI, and `TERM=dumb` use plain output without menus or cursor movement. Bare `jpm` shows help in those environments. `NO_COLOR=1` disables colors while retaining terminal interaction. `--help`, `--version`, `--json`, and `jdk env` do not gain a banner or interactive menu.

## Create a project

```sh
jpm create my-app --java 21 -y
```

| Option | Meaning |
| --- | --- |
| `<name>` | Lowercase kebab-case directory/artifact name |
| `--java <major>` | Java target; otherwise configured default, then 21 |
| `--boot <version>` | Exact version currently offered by Initializr |
| `--group <groupId>` | Java group, default `com.example` |
| `--package-name <package>` | Explicit Java package; otherwise derived from group/name |
| `--template spring` | The only supported template: Spring MVC |
| `-y`, `--yes` | Skip interactive questions; provide a project name |

In an interactive terminal, missing name/Java choices are prompted. The Java selector offers the configured default, detected installed versions, and entry of another major version. Selecting a version does not install it; Spring Initializr still validates the requested Java target. Use `-y` and a project name to skip the wizard, including in a terminal.

Creation fetches an official Maven template and adds a JSON manifest, `.jpmrc`, hello endpoint, and HTTP test. It refuses an existing destination. It does not install dependencies, install a JDK, or start a server. Completion output lists the next commands only after the project is created.

## Dependencies and POM

```sh
jpm install
jpm add org.springframework.boot:spring-boot-starter-validation
jpm add org.assertj:assertj-core --scope test
jpm add org.apache.commons:commons-lang3@3.20.0
jpm remove org.apache.commons:commons-lang3
jpm sync
```

`install` synchronizes the POM and invokes Maven `dependency:go-offline`. It does not install npm dependencies. `add` supports `--scope compile|runtime|provided|test` and `--optional`, then resolves dependencies. Preflight errors leave the manifest/POM unchanged; a Maven failure after saving leaves the declaration in place. Retry `jpm install` or remove it explicitly.

`remove` updates JSON/POM without a Maven invocation. `sync` only writes the generated POM. Both preserve the guard against overwriting manual POM edits.

```sh
jpm list --json
jpm tree -- -Dverbose
jpm tree -- '-Dincludes=org.apache.commons:*'
```

`list` reads direct declarations only, without a JDK or network. Its missing-version label means Boot management was requested, not that the coordinate is known to Boot. `tree` runs Maven and shows resolved direct/transitive versions; it needs a usable JDK and Wrapper and may download artifacts.

## Development, tests, and builds

```sh
jpm dev
jpm test
jpm build
jpm test -- -Dtest=JpmHelloTests
jpm build -- -DskipTests
jpm dev -- -Dspring-boot.run.arguments=--server.port=8081
```

Arguments after `--` are forwarded literally to Maven, including `--help`. `build` runs Maven `package` and normally includes tests. `jpm run dev|test|build` is an alias for these commands, not an arbitrary npm script runner.

`dev` requires the Boot DevTools dependency. It watches Java/resource files under `src/main`, serializes compilation, and triggers a restart only after successful compilation. Deleted/renamed files cause stale outputs to be cleaned. Fix a compilation error and save again to retry. Restart the CLI after dependency, Java-version, or build-configuration changes. Ctrl-C stops the CLI and its Maven process group.

## JDK management

```sh
jpm jdk
jpm jdk list
jpm jdk list 21
jpm jdk list --remote
jpm jdk list 21 -r
jpm jdk install 21
jpm jdk i 21
jpm jdk use 21
jpm jdk use 21 --global
eval "$(jpm jdk env)"
```

- `jdk` lists installed JDKs, with the installation selected for jpm first. The current row has a blue accent and a `*` / `(current)` label, followed by the configuration source. This is jpm's selection, which may differ from the shell's `java`. Listing does not change it.
- `jdk list` is an alias for `jdk`. Both detect installations and verify `java` and `javac`, without network access. `jdk list <major>` filters this local list; a current installation outside the filter is not shown. With no configuration, they list installations without marking one current. Invalid configuration or an unavailable selected JDK produces an error after displaying the installed versions.
- `jdk list --remote` (or `-r`) queries Temurin releases for the current operating system and CPU. It shows the latest available GA release for each supported major version; `jdk list 21 -r` shows the available Java 21 patch/build history. Only JDKs are listed, not JREs or early-access builds. Installed/current labels require a matching detected Temurin runtime version. Remote listing fetches metadata only: it does not download JDK archives or change the selection.
- `jdk install [major]` (or `jdk i [major]`) installs a Temurin JDK to `~/.jpm/jdks/<major>` and verifies size/checksum. It reuses an existing complete cached installation, without upgrading it or changing the selection. Omitting the version requires an existing selection. Installation supports x64 and arm64 on macOS/Linux.
- `jdk use <major> [--global]` reuses a usable local JDK of that major version, regardless of distribution. If none is found, it installs Temurin. It checks project target compatibility before downloading and saves the choice in project/user `.jpmrc` only after successful preparation; a failed download leaves the previous choice intact. `--global` saves the user default without imposing the current project's target. Neither form changes the project's compilation target.
- `jdk env [major]` prints quoted bash/zsh-compatible exports. It does not edit shell startup files; review the output before evaluating it.

Version arguments are major versions from 17 to 99. New downloads select the latest available Temurin release for that major. Although remote listing displays full patch/build versions, installing or pinning an exact build and selecting another distribution are not supported yet. There are no `--distribution`, `--all`, or `--versions` flags; use a positional major version and `--remote` to choose the listing scope.

See [JDK configuration](configuration.md#jdk-selection) for precedence and project boundaries.

## Diagnostics and exit status

```sh
jpm doctor
jpm doctor --json
```

`doctor` checks Node/platform, JSON, JDK selection, target compatibility, shell environment, Maven Wrapper, and POM state. It executes local Java version probes, but does not call Maven, access the network, install tools, or change files.

In a terminal, doctor shows an environment summary followed by labeled check results and repair suggestions. Warnings and errors remain visible even when colors are disabled. Redirected output keeps the plain checklist, and `doctor --json` always emits only the JSON report.

JSON output has `ok` and `checks`; each check includes `name`, `status` (`ok`, `warn`, `error`), `detail`, and an optional `action`. Any error produces exit 1; warnings alone do not. Maven commands propagate failure status; signal exits use conventional codes such as 130 for SIGINT and 143 for SIGTERM.
