# Security policy

## Supported versions

jpm is in alpha. Security fixes are developed on `main` and, once releases are published, shipped in the latest alpha. There is no stable release or long-term maintenance branch yet. Upgrade to the latest available alpha when a fix is released.

## Report a vulnerability

Email **carbon1024@foxmail.com** privately. If GitHub shows a **Report a vulnerability** option under this repository's Security tab, that private channel may also be used. Do not open a public issue containing exploit details or secrets.

Include the affected jpm/Node/OS versions, a minimal reproduction, the expected security impact, and any proposed fix. Redact credentials, private Maven repository URLs, tokens, and identifying filesystem paths. Do not test against systems you do not own or have permission to test.

The maintainer will investigate and coordinate a fix and disclosure where appropriate. This volunteer project does not promise a response or remediation deadline, and does not offer a bug bounty.

## Trust boundaries

jpm downloads Spring templates and optional JDK archives, writes project files, and executes the project's Maven Wrapper and Java tools. It is a development tool, not a sandbox. Only run projects and wrappers you trust.

JDK downloads are checked against the provider's size and SHA-256 metadata. Template and JDK extraction apply path/type/size checks. These controls do not make arbitrary Maven plugins, dependency repositories, or downloaded applications trustworthy.

For ordinary setup failures, use the [troubleshooting guide](docs/troubleshooting.md) or a bug report instead.
