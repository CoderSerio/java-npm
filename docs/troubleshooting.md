# Troubleshooting

Start with `jpm --version`, `node --version`, and `jpm doctor --json` from the project root. The doctor output helps locate configuration problems; it does not prove network access or a successful Maven build.

| Symptom | What to check |
| --- | --- |
| `jpm: command not found` | Install `java-npm` globally, then check your npm global bin directory is on PATH. Restart/reconfigure your terminal if needed. |
| npm cannot find `java-npm@alpha` | The first alpha may not be published yet. Check npm availability; use the source-build path in CONTRIBUTING meanwhile. |
| Node 26 required | Select Node 26+ with your version manager. Check `node --version` in the same shell running jpm. |
| No project manifest | Run project commands from the generated application's root, not the jpm source repository or a source subdirectory. |
| JDK not found | Run `jpm jdk list`; select a complete JDK with both java and javac, or explicitly run `jpm jdk install <major>`. |
| JDK older than target | Select a JDK at least as new as `package.json.java.version`; do not silently lower the compilation target. |
| Shell Java differs from jpm | Inspect `jpm jdk env`; evaluate it in bash/zsh if you also want to switch that terminal. |
| Missing/non-executable Maven Wrapper | Restore the generated wrapper files. On macOS/Linux, restore executable permission with `chmod +x mvnw`. |
| Modified/unmanaged POM | Back it up and review the changes. jpm will not overwrite it. Remove it only if you intend to regenerate from JSON with `jpm sync`. |
| Maven fails after `jpm add` | The dependency declaration remains saved. Correct the coordinate/version or network issue and run `jpm install`, or remove it explicitly. |
| Initializr rejects a version | Choose a version currently offered by Initializr. Avoid assuming an old Boot/Java combination is still offered. |
| Port 8080 already used | Run `jpm dev -- -Dspring-boot.run.arguments=--server.port=8081`. |
| Java compilation fails during dev | Read the Maven output, fix the source, and save again. A failed compilation should not trigger a successful reload. |
| Config/dependency change is not reflected | Stop and restart `jpm dev` after dependency, JDK, or build-configuration changes. |
| Interrupted JDK installation | Verify no installer is active before removing the reported stale lock. Move an incomplete installation aside; jpm will not overwrite it. |

## Network and private repositories

npm installs the CLI; Initializr supplies templates; Adoptium supplies optional JDKs; Maven resolves Java dependencies and plugins. A working connection to one service does not establish access to the others.

Use your normal Maven settings for mirrors and credentials. Do not put secrets into a shared manifest, issue, or log. A cached `jpm install` is not proof that a fresh machine can build offline.

## Before filing an issue

Use the bug-report template with a minimal reproduction, jpm/Node/JDK versions, OS/architecture, the exact command, and sanitized output. State whether the problem occurs from an installed npm archive or a source checkout. Include what changed and what you expected; do not attach a complete private project.

For suspected vulnerabilities, follow [SECURITY.md](../SECURITY.md).
