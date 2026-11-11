<p align="center">
  <img src="assets/brand/jpm-readme.png" alt="jpm" width="360">
</p>

<p align="center"><strong>An npm-style workflow for Java and Spring Boot.</strong></p>

<p align="center">
  <a href="https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml"><img src="https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A526-004c34" alt="Node.js 26 or newer"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/status-alpha-27cd77" alt="Alpha"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-004c34" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

**jpm** brings familiar frontend commands to Java: create an application, add a dependency, start development, and build a JAR. Java dependencies live in `package.json`; jpm generates the POM and runs Maven through the project's Wrapper.

Spring Initializr provides the starting project. Maven handles dependency resolution and builds. Your application runs on the JVM, with no Node.js runtime dependency.

- **Start with a working application.** Generate a Spring MVC project with an HTTP endpoint and tests.
- **Keep dependencies readable.** Declare Maven coordinates in JSON and synchronize the POM, with protection against overwriting manual edits.
- **Edit, compile, restart.** `jpm dev` watches Java and resource files, recompiles changes, and restarts the application through Spring DevTools.
- **Choose Java per project.** Commit a `.jpmrc`, select an installed JDK, and use `jpm doctor` to diagnose configuration problems.

> **Alpha:** currently focused on new, single-module Spring MVC projects on macOS and Linux. Commands and configuration may change.

## Quick start

Use **Node.js 26+** and **JDK 21** on macOS or Linux. A separate Maven installation is not required.

<!-- publication-status:start -->
The first npm alpha is being prepared. The registry installation below becomes available after publication; you can [build from source](CONTRIBUTING.md#development-setup) now.
<!-- publication-status:end -->

```sh
npm install --global java-npm@alpha
jpm create my-app --java 21 -y
cd my-app
jpm install
jpm dev
```

Open **<http://localhost:8080/>** to see the generated application's response. Edit its Java controller and save to see the development restart.

Need a JDK? Run `jpm jdk install 21` before `jpm install`. JDK downloads are explicit; project creation does not install tools or dependencies. Initial setup needs network access for uncached artifacts.

The npm package is **`java-npm`**; the installed command is **`jpm`**.

## A familiar development loop

```sh
jpm add org.springframework.boot:spring-boot-starter-validation
jpm test      # Run the application's tests
jpm build     # Test and package an executable JAR
```

Use `jpm list` for direct declarations, `jpm tree` for resolved dependencies, and `jpm doctor` for environment checks. Pass Maven arguments after `--`, for example `jpm build -- -DskipTests`.

[Explore the CLI →](docs/cli.md)

## Java dependencies in JSON

Add a dependency with `jpm add`, or edit the `java.dependencies` section of your project's `package.json`:

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

This is a manifest fragment. Empty objects use Spring Boot dependency management; other dependencies need an explicit Maven version. Run `jpm install` after editing the manifest to synchronize the POM and resolve dependencies.

npm distributes the CLI. `jpm install` resolves **Java dependencies through Maven**. Each developer installs jpm separately; generated projects contain no bundled CLI archive.

[Read the configuration guide →](docs/configuration.md)

## Documentation

[Commands](docs/cli.md) · [Configuration and JDK selection](docs/configuration.md) · [Troubleshooting](docs/troubleshooting.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

The alpha supports new single-module Maven projects. Existing POM import, Gradle, Windows, multi-module builds, custom BOMs/plugins in JSON, and Java dependency locking are outside the current scope. See the [validation record](VALIDATION.md) for tested environments and limitations.

## Contributing

Bug reports, documentation improvements, and focused patches are welcome. Read the [contributing guide](CONTRIBUTING.md), then use the issue or PR template. English and Chinese are both welcome.

[Code of Conduct](CODE_OF_CONDUCT.md) · [Report a vulnerability privately](SECURITY.md)

## License

[MIT](LICENSE) © 2026 Carbon and contributors.

jpm is an independent project, unaffiliated with Java, npm, Maven, or Spring.
