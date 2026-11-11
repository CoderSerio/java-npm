# Contributing to jpm

Thank you for helping improve jpm. Reproducible bug reports, clearer documentation, and small, well-tested changes are valuable contributions. English and Chinese are both welcome in issues and discussions.

Read the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately using [SECURITY.md](SECURITY.md), not a public issue.

## Before making a change

Search open and closed issues and PRs. For a new command, configuration format, dependency, or substantial behavior change, open a feature proposal first so the design can be discussed. A focused bug fix or documentation correction can go straight to a PR.

The alpha scope is new single-module Spring MVC projects, Maven, macOS/Linux, and Node 26+. See the [roadmap](docs/roadmap.md). Keep unrelated refactors and formatting changes out of a fix.

## Development setup

Fork the repository, clone your fork, and create a topic branch from an up-to-date `main`:

```sh
git switch main
git pull --ff-only
git switch -c fix/describe-the-problem
nvm use
npm ci
npm run check
```

Use Node **26.13.0**, recorded in `.node-version` and `.nvmrc`; another version manager is fine. TypeScript **7.0.2** is pinned in devDependencies. `npm run build` emits ESM JavaScript to `dist/`. Do not commit `dist/`, `node_modules/`, generated test projects, or npm archives.

```sh
npm run typecheck
npm test
node bin/jpm.js --help
npm pack
```

`npm test` builds before running Node's test runner. Tests import the built modules and use temporary directories, fake JDKs, and mocked downloads. `npm ci` needs access to dependencies; the test suite itself should not require internet access or a preinstalled JDK. A real Java smoke test needs an appropriate JDK and network/cache access.

## Branches and PR titles

Use short-lived branches named `<type>/<kebab-case-topic>`, such as `feat/jdk-selection`, `fix/pom-validation`, or `docs/quick-start`.

Allowed types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`, `release`. Do not use personal or agent-name prefixes. `main` is the default integration branch; do not push changes directly to it.

Use a Conventional Commit-style PR title, for example:

```text
fix: preserve dependency scope when updating a version
docs: clarify JDK selection and compile targets
feat(cli): add a project diagnostic command
```

Target `main`. CI and contribution checks must pass, and review conversations must be resolved. Maintainers squash-merge PRs. The repository deletes merged head branches automatically; contributors may still need to delete their fork's branch themselves. See the [maintainer guide](docs/maintaining.md) for the exact policy.

## What a good patch includes

- Describe the concrete problem and resulting behavior in the PR template.
- Add a regression test for a real failure or risk. Reuse existing fixtures; do not duplicate implementation details in assertions.
- Preserve user files, POM modification detection, archive limits, JDK verification, and child-process cleanup. Explain any intentional change to those contracts.
- Validate external JSON/XML at runtime. Keep strict TypeScript checks; avoid broad `any`, `@ts-ignore`, and unchecked casts to make a build pass.
- Update the relevant docs and both READMEs when changing the quick start, supported platforms, or headline behavior.
- Run `npm run check` for code/build changes. For docs-only changes, check links, commands, and examples; state exactly what you verified.

If AI tools materially assisted the contribution, briefly disclose their role in the PR. You are responsible for understanding the patch, checking its claims, and verifying its behavior. Never include credentials, private data, or generated output you have not reviewed.

## Review and releases

Maintainers may ask for a smaller scope or a reproduction before accepting a change. There is no guaranteed response time. Avoid repeated pings or opening duplicate PRs.

Do not bump the package version or publish a package as part of an unrelated contribution. Releases are coordinated by the maintainer using the [release guide](docs/releasing.md). Contributions are made under the project's [MIT license](LICENSE).
