# Working on jpm

Read CONTRIBUTING.md and the relevant docs before making changes.

## Repository workflow

- `main` is the default branch. Work on a semantic topic branch; never force-push or directly push to `main`.
- Keep the change focused. Check current issues/PRs before starting and again before pushing.
- Do not create, edit, merge, or comment on a PR, publish packages, or change repository visibility without explicit user authorization.
- Preserve unmerged work. GitHub deletes head branches after PR merges; delete other remote branches only after verifying the work was merged and deletion was authorized.
- Prefer truthful, concise change descriptions and record only checks actually run.

## Implementation

- Use Node 26 and strict TypeScript 7. Runtime sources are in `src/`; ESM output is in `dist/` and is not committed.
- `npm run check` performs type checking, build, and Node tests. Tests import `dist/`.
- Preserve POM overwrite protection, atomic writes and modes, archive validation, JDK checks, and process-group cleanup.
- Treat JSON/XML and remote metadata as untrusted input. Keep runtime validation in addition to static types.
- Keep tests independent of host JDKs and network. Add behavior-level regressions where warranted.
- Generated Java projects do not contain npm dependencies on jpm, a vendor archive, or install hooks.

## Documentation and releases

- Keep README.md and README.zh-CN.md aligned. Detailed references belong in docs/.
- Do not claim npm availability, platform support, benchmarks, or security guarantees without evidence.
- Alpha packages use the `alpha` dist-tag. Validate the actual archive and follow docs/releasing.md.
- Do not store secrets, generated projects, build outputs, or discarded design variants in the repository.
