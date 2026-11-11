# Changelog

Changes are recorded here before release. An entry under **Unreleased** is not evidence that a package has been published.

## Unreleased — 0.1.0-alpha.0

### Added

- Spring MVC project creation through Spring Initializr.
- Java dependency declarations in `package.json`, generated POM synchronization, and protection against overwriting manually edited POMs.
- Maven install, test, build, dependency tree, and development commands.
- JDK discovery, explicit Temurin installation with checksum verification, project/user selection, and shell environment output.
- Read-only environment diagnostics and declared dependency listing.
- macOS/Linux CI, contribution templates, project documentation, and MIT licensing.

### Changed

- CLI implementation migrated to strict TypeScript 7 with compiled ESM output.
- Minimum Node.js version raised to 26.
- Generated projects use a separately installed jpm CLI instead of embedding a CLI archive or npm dependency.

### Fixed

- Java version validation rejects values that only coerce to a version, such as `[21]`.
- Initializr metadata is checked before reading version choices.
- JDK discovery tests are isolated from the host's installed JDKs.

See the [alpha release notes](docs/releases/0.1.0-alpha.0.md) for scope and the [validation record](VALIDATION.md) for evidence.
