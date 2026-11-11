# Scope and roadmap

This is a direction for discussion, not a delivery schedule. Features become supported only when implemented, documented, and verified.

## Available in the alpha candidate

- New single-module Spring MVC projects through Initializr.
- JSON-managed Maven dependencies and POM synchronization.
- Development compilation/restart, tests, JAR builds, dependency inspection, and diagnostics.
- JDK discovery, major-version selection, shell exports, and explicit verified Temurin installation.
- Node 26+, macOS/Linux, and a separately installed CLI.

## Next priorities

1. Publish and validate the first alpha on a fresh machine.
2. Gather feedback on installation, failure messages, and the create-to-dev workflow.
3. Stabilize the supported configuration and document any migrations between alpha releases.
4. Improve reproducibility and CI coverage where real user reports reveal gaps.

## Proposals requiring design work

Existing Maven project import, Gradle, Windows, multi-module projects, additional templates, exact JDK vendor/build pinning, and Java dependency locking need separate designs and tests. They are not part of the current support promise.

Use the feature-request template to explain a concrete workflow, current workaround, and expected benefit. Avoid treating this list as a commitment to implement every item.
