# Maintainer guide

## Branch and review policy

`main` is the default branch. Keep feature work on short-lived semantic branches and merge through a PR. Do not use a long-lived `develop` branch for the alpha.

Repository settings:

| Setting | Policy |
| --- | --- |
| Merge method | Squash only; use the PR title as the commit title |
| Required checks | `check (ubuntu-latest)`, `check (macos-latest)`, `contribution-policy` |
| Base freshness | Branch must be up to date before merging |
| Reviews | PR required; unresolved review conversations block merging |
| Approval count | Zero mandatory approvals while there is one maintainer |
| History | Linear; no force pushes or deletion of `main` |
| Administrators | Branch protection applies |
| Head branches | Automatically delete repository branches after merge |

Zero required approvals avoids making a sole maintainer unable to merge their own work. It is not a claim of independent review. Increase the requirement when another active maintainer can review reliably. CODEOWNERS identifies responsibility; code-owner approval is not currently mandatory.

The contribution workflow validates semantic head-branch names and Conventional Commit-style PR titles. The CI workflow type-checks, tests, packs, and installs the CLI on Ubuntu and macOS. Changes to workflows and repository settings deserve particular attention; a workflow file alone does not configure branch protection.

## Reviewing a change

Check the linked issue and related PRs for duplicate or superseded work. Review the behavior, compatibility boundary, tests, documentation, and scope. For core changes, pay attention to input validation, POM ownership, file permissions, JDK selection, and child-process cleanup. Ask for a reproduction when the problem is unclear.

Before merging, verify required checks on the latest commit, resolve discussions, and make the PR title describe the final change. Use a squash commit. Preserve useful context in the PR description; do not require contributors to produce an artificial number of commits or tests.

## Cleaning up merged branches

GitHub removes eligible head branches in this repository after a PR merges. A contributor's fork may need separate cleanup.

For local cleanup, first confirm that the PR was merged and the branch contains no later work. Then update `main`, prune stale remote references, and try normal deletion:

```sh
git switch main
git pull --ff-only
git fetch --prune origin
git branch -d feat/example
```

A squash merge can make `git branch -d` refuse deletion because the original commits are not ancestors of `main`. Do not equate that refusal with lost work, and do not force-delete blindly. Inspect the merged PR, squash commit, branch changes, and any commits added after merging. Preserve or back up uncertain work before explicitly deleting it. Never delete an unmerged branch merely because it is old.

## Repository administration

Keep the repository description, topics, documentation, issue forms, and default branch consistent. Use the private reporting address in [SECURITY.md](../SECURITY.md); enable GitHub private vulnerability reporting when available and verify it before documenting it as enabled.

The repository may remain private during preparation. Publishing code, changing visibility, merging a PR, and publishing npm are distinct actions. A green build does not authorize an agent to perform those actions on a maintainer's behalf.

Follow the [release guide](releasing.md) for packages and the [launch checklist](launch/README.md) before announcing availability.
