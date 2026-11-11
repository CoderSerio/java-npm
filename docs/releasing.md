# Publishing an alpha

This is a maintainer procedure, not an automatic release workflow. The package is `java-npm`; the command is `jpm`. Alpha versions use the `alpha` dist-tag. Do not move `latest` to an alpha.

## Prepare the release

1. Agree on the exact version and release scope. Update `package.json`, the lockfile, changelog, and release notes together.
2. Review and merge the release changes into `main`. Confirm required checks pass for the commit being released. Work from a clean checkout of that commit.
3. Ensure README status text matches the intended release. Prepare the publication text before packing; announce availability only after registry verification.
4. Verify that the public source and license are ready to accompany a public package. Review the files list for private data and unintended files.

```sh
git switch main
git pull --ff-only
git status --short
node --version
npm ci
npm run check
```

Stop if the tree is dirty or checks fail. Use the Node version pinned in the repository. Read [VALIDATION.md](../VALIDATION.md) for the most recent evidence and its limits; do not copy an older smoke result into a new release as a fresh test.

## Inspect and install the actual archive

Use a new temporary directory. After `npm run check` has built the package:

```sh
release_dir=$(mktemp -d)
archive=$(npm pack --ignore-scripts --pack-destination "$release_dir" --silent)
tar -tzf "$release_dir/$archive"
npm install --prefix "$release_dir/install" --omit=dev --ignore-scripts "$release_dir/$archive"
"$release_dir/install/node_modules/.bin/jpm" --version
"$release_dir/install/node_modules/.bin/jpm" --help
shasum -a 256 "$release_dir/$archive"
```

The archive must include compiled `dist/`, executable wrappers, the MIT license, README files, and their documentation/assets. It must exclude tests, TypeScript sources, the compiler, local caches, credentials, and other archives. Users must not need a TypeScript compiler or an install hook.

Use the installed CLI to create a disposable project, resolve dependencies, run `doctor`, build, and exercise the dev/reload/stop loop. Record the actual OS, Node/JDK/Maven/Boot versions, results, and any skipped checks. Cached dependency resolution does not prove a cold or offline installation works.

If anything in the package changes after inspection, rebuild, repack, and verify the new archive. Keep the exact verified artifact for publication.

## Authenticate and publish

The maintainer signs in locally with npm. Do not paste tokens, passwords, or one-time codes into issues, PRs, or chat logs.

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view java-npm dist-tags --json --registry=https://registry.npmjs.org/
```

Check the exact candidate version with `npm view java-npm@<version> version`. For a first publication, an explicit registry 404 means the package/version was not found at that moment; authentication, permission, or network errors are not proof that a name is available. Never overwrite or reuse a published version.

Once publication is authorized, publish the exact archive that was inspected above:

```sh
npm publish "$release_dir/$archive" --tag alpha --access public --registry=https://registry.npmjs.org/
```

Do not depend on package lifecycle hooks to validate an already-built tarball. Run the checks explicitly before publishing it. Complete any npm authentication prompt in the maintainer's own terminal/browser.

## Verify distribution and document the result

```sh
npm view java-npm@0.1.0-alpha.0 version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org/
npm view java-npm dist-tags --json --registry=https://registry.npmjs.org/
verify_dir=$(mktemp -d)
npm install --prefix "$verify_dir" --cache "$verify_dir/cache" --omit=dev --ignore-scripts java-npm@0.1.0-alpha.0 --registry=https://registry.npmjs.org/
"$verify_dir/node_modules/.bin/jpm" --version
"$verify_dir/node_modules/.bin/jpm" --help
```

Replace the example version consistently for later releases. Verify that `alpha` points to that version and `latest` was not moved to it. Confirm a new installation from the registry, not just the local tarball. Record the registry integrity and tested source commit.

With maintainer authorization, tag the released source commit as `v<version>` and publish a GitHub release marked **pre-release**, using the reviewed notes. Do not move an existing release tag. Update the changelog/status and then use the [launch kit](launch/README.md).

## If publication fails

Inspect registry state before retrying: an interrupted client can still have published successfully. If the version exists, verify it rather than republishing. A broken published release normally needs a new alpha version and a clear migration note. Do not silently replace artifacts, rewrite tags, or unpublish as a routine retry.
