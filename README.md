<div align="center">

<img src="assets/brand/jpm-readme.png" alt="jpm — coffee bean and terminal logo" width="480">

# jpm

**A familiar command-line workflow for Java and Spring Boot.**

[![CI](https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml/badge.svg)](https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml)
[![Node.js 26+](https://img.shields.io/badge/node-%E2%89%A526-417e38)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Alpha](https://img.shields.io/badge/status-alpha-orange)](CHANGELOG.md)

[中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) · [Roadmap](docs/roadmap.md)

</div>

jpm brings `create`, `add`, `dev`, `test`, and `build` to Java projects, with Java dependencies declared in `package.json`. It generates a standard Maven POM and runs the project's Maven Wrapper. Spring Initializr supplies the project template; Maven still handles dependency resolution and builds.

The npm package is **`java-npm`**. The installed command is **`jpm`**.

> **Alpha release candidate:** `0.1.0-alpha.0` is being prepared for its first npm publication. The registry installation command below becomes available after publication. Commands and configuration may change during alpha.

## Why jpm?

- **A small set of familiar commands.** Create a Spring MVC application, add a dependency, and start development from one CLI.
- **Readable project configuration.** Edit Java coordinates in `package.json`; jpm keeps the generated POM in sync and detects manual POM edits.
- **Explicit JDK selection.** Commit a project `.jpmrc`, inspect installed JDKs, or explicitly download a verified Temurin JDK.
- **An integrated development loop.** Java and resource edits trigger compilation and Spring DevTools restarts. `doctor` reports actionable environment checks.
- **Standard Java build output.** Maven builds an executable Spring Boot JAR. The Java application does not need Node.js to run.

## Quick start

You need **Node.js 26+** on **macOS or Linux**. The example uses **JDK 21**. A system Maven installation is not required.

After the alpha is published:

```sh
npm install --global java-npm@alpha
jpm --version
jpm create my-app --java 21 -y
cd my-app
```

If JDK 21 is not installed, run `jpm jdk install 21` explicitly. Then:

```sh
jpm install
jpm doctor
jpm dev
```

Open <http://localhost:8080/>:

```json
{"message":"Hello from jpm!"}
```

Creation generates files; it does not install dependencies or start the app. Initializr, npm, Maven repositories, and optional JDK downloads require network access when their artifacts are not cached.

**Trying the unreleased code?** See [building from source](CONTRIBUTING.md#development-setup). You can run `node /absolute/path/java-npm/bin/jpm.js` after building, or install the archive produced by `npm pack`.

## Your daily workflow

```sh
jpm add org.springframework.boot:spring-boot-starter-validation
jpm list
jpm tree
jpm test
jpm build
```

| Command | What it does |
| --- | --- |
| `jpm create <name>` | Generate a Spring MVC project from Initializr |
| `jpm install` | Sync the POM and resolve Java dependencies with Maven |
| `jpm add <group:artifact[@version]>` | Save and resolve a Java dependency |
| `jpm remove <group:artifact>` | Remove a declaration and update the POM |
| `jpm dev` | Compile changes and restart the development application |
| `jpm test` / `jpm build` | Run Maven tests / test and package a JAR |
| `jpm list` / `jpm tree` | Inspect declared / resolved dependencies |
| `jpm doctor` | Inspect configuration, JDK, Wrapper, and POM state |
| `jpm jdk` | Inspect, install, or select a JDK |

Pass Maven options after `--`, for example `jpm build -- -DskipTests`. See the [CLI reference](docs/cli.md) for all commands and options.

## One configuration, standard tooling

```text
package.json → generated pom.xml → Maven Wrapper → tests / executable JAR
    .jpmrc  → selected JDK ──────────────┘
```

Java dependencies live under `java.dependencies`, not npm's top-level `dependencies`:

```json
{
  "java": {
    "dependencies": {
      "org.springframework.boot:spring-boot-starter-validation": {},
      "org.assertj:assertj-core": { "scope": "test" }
    }
  }
}
```

This is a fragment of a generated manifest. Empty objects request Spring Boot dependency management; dependencies not managed by Boot need an explicit Maven version. See [configuration](docs/configuration.md) for the full format.

npm distributes the CLI. **`jpm install` resolves Java dependencies; it does not run `npm install`.** Generated projects contain no bundled jpm archive or npm dependency on the CLI. Teammates install jpm separately.

## Current scope

The alpha supports **new, single-module Spring MVC projects using Maven on macOS/Linux**. It does not import arbitrary existing POMs or support Windows, Gradle, multi-module builds, custom BOMs, or arbitrary plugins and repository declarations in the JSON configuration.

Java dependencies are resolved by Maven; jpm does not provide a Java dependency lockfile. JDK selection is by major version, not an exact vendor/build. See [scope and roadmap](docs/roadmap.md) and [troubleshooting](docs/troubleshooting.md).

## Contribute

Bug reproductions, documentation improvements, and focused changes are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), use the issue and PR templates, and target `main`. The project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

Security concerns should be reported privately through [SECURITY.md](SECURITY.md). Validation evidence is recorded in [VALIDATION.md](VALIDATION.md).

## License

[MIT](LICENSE) © 2026 Carbon and contributors. jpm is an independent project and is not affiliated with the Java, npm, Maven, or Spring projects.
