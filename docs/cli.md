# CLI reference

The npm package `java-npm` installs the `jpm` command. Use `jpm --help` and `jpm --version` to inspect the installed CLI. Node 26+ and macOS/Linux are required.

Unless noted otherwise, project commands run from the directory containing the project's `package.json` and `mvnw`.

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

In an interactive terminal, missing name/Java choices are prompted. Creation fetches an official Maven template and adds a JSON manifest, `.jpmrc`, hello endpoint, and HTTP test. It refuses an existing destination. It does not install dependencies, install a JDK, or start a server.

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
jpm jdk install 21
jpm jdk use 21
jpm jdk use 21 --global
eval "$(jpm jdk env)"
```

- `jdk` shows the selected JDK and configuration source.
- `jdk list` detects installations and verifies both `java` and `javac`.
- `jdk install [major]` explicitly downloads a Temurin JDK to `~/.jpm/jdks/<major>` and verifies size/checksum. Omitting the version requires an existing selection. Installation supports x64 and arm64 on macOS/Linux.
- `jdk use` verifies an installed JDK and saves the choice in project/user `.jpmrc`; it does not change the project's compilation target.
- `jdk env [major]` prints quoted bash/zsh-compatible exports. It does not edit shell startup files; review the output before evaluating it.

See [JDK configuration](configuration.md#jdk-selection) for precedence and project boundaries.

## Diagnostics and exit status

```sh
jpm doctor
jpm doctor --json
```

`doctor` checks Node/platform, JSON, JDK selection, target compatibility, shell environment, Maven Wrapper, and POM state. It executes local Java version probes, but does not call Maven, access the network, install tools, or change files.

JSON output has `ok` and `checks`; each check includes `name`, `status` (`ok`, `warn`, `error`), `detail`, and an optional `action`. Any error produces exit 1; warnings alone do not. Maven commands propagate failure status; signal exits use conventional codes such as 130 for SIGINT and 143 for SIGTERM.
