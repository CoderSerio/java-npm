# Configuration

## Project manifest

jpm reads `package.json` in the current project directory. Java settings live under `java`; top-level npm dependency fields, if present, are not handled by `jpm install`.

A complete example for Spring Boot 4:

```json
{
  "name": "my-app",
  "version": "0.0.1-SNAPSHOT",
  "private": true,
  "java": {
    "version": "21",
    "springBoot": "4.1.2",
    "groupId": "com.example",
    "artifactId": "my-app",
    "packageName": "com.example.myapp",
    "dependencies": {
      "org.springframework.boot:spring-boot-starter-webmvc": {},
      "org.springframework.boot:spring-boot-devtools": {
        "scope": "runtime",
        "optional": true
      },
      "org.springframework.boot:spring-boot-starter-webmvc-test": {
        "scope": "test"
      }
    }
  }
}
```

`create` takes the actual dependencies and selected Boot version from Initializr. This example is not a recommendation to overwrite another Boot version's generated dependencies.

| Field | Contract |
| --- | --- |
| `java.version` | Java compilation target, as a string or number; manifest validation accepts major versions 17–99 |
| `java.springBoot` | Exact Boot version; creation also requires Initializr to offer it |
| `java.groupId` | Dotted Java identifiers |
| `java.artifactId` | Lowercase kebab-case artifact name |
| `java.packageName` | Optional Java package name |
| `java.dependencies` | Map of Maven `group:artifact` coordinates |
| `version` | Optional project/Maven version, default `0.0.1-SNAPSHOT` |
| `name`, `description` | Optional text used in the generated POM |

A dependency value can be an exact version string or an object with `version`, `scope`, and `optional`. Scopes are `compile`, `runtime`, `provided`, and `test`. Empty objects omit the version so Boot dependency management can apply. npm version ranges such as `^` and `~` are not accepted. Unknown Java/dependency settings are rejected rather than silently dropped.

## Generated POM

`package.json` is the source of truth. jpm writes a standard `pom.xml` with a content digest and refuses to overwrite an unmanaged or manually modified POM. To regenerate intentionally, back up and review the existing POM, remove it, and run `jpm sync`.

The supported model is a single module with the Spring Boot parent and Maven plugin. Custom BOMs, extra plugins/repositories, profiles, and multi-module configuration are not represented. Maven still uses its normal settings for repository access; the JSON format is not a complete Maven model.

Maven resolves transitive dependencies and managed versions. An npm lockfile does not lock Java dependencies, and jpm currently has no separate Java lockfile.

## JDK selection

A project `.jpmrc` can be committed:

```ini
# JDK used to run Maven
java=21
```

Only the `java` key, blank lines, and `#`/`;` comments are supported. Duplicate/unknown keys, sections, interpolation, and shell commands are rejected. `jdk use` preserves existing comments and file permissions and refuses symlinked config files.

Selection order:

1. Explicit command version where supported.
2. Nearest project `.jpmrc`.
3. Existing project's `package.json.java.version` fallback.
4. User `~/.jpmrc`.

Creation has no existing-project fallback and defaults to 21 if no selection is available. Upward project lookup stops at package/repository boundaries or the user home. Running `jdk use` from a subdirectory writes at the nearest applicable project boundary when no nearer rc exists.

The selected JDK runs Maven; `java.version` remains the compilation target. A newer selected JDK can build an older target. A JDK older than that target is rejected before Maven runs. Exact vendor/build selection is not currently supported.

`jdk use` cannot change its parent shell. To change the current bash/zsh environment, use `eval "$(jpm jdk env)"`. No shell startup files or automatic directory hooks are installed.
