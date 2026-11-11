# jpm

用统一的 jpm 命令开发 Java / Spring 应用，以 package.json 管理 Java 依赖。

这是 [jpm idea](https://github.com/CoderSerio/blog/issues/15) 的第一个可运行版本，仓库为 [CoderSerio/java-npm](https://github.com/CoderSerio/java-npm)：Node.js CLI 创建 Spring MVC 项目，以 `package.json` 为配置源，生成标准 `pom.xml`，通过 Maven Wrapper 完成依赖解析、测试、开发和打包。

## 快速开始

要求 Node.js 22+，支持 macOS / Linux。默认使用 Java 21；无需预装 Maven。

包名为 `java-npm`，安装后的命令为 `jpm`。当前首版尚未发布，保持 `private: true`；拿到本地压缩包后，一次性安装 CLI：

```sh
npm install --global ./java-npm-0.1.0.tgz
jpm --version
```

npm 用于分发和安装 jpm 工具。之后创建、安装 Java 依赖和运行项目都使用 jpm：

```sh
jpm create my-app --java 21 -y
cd my-app
jpm install
jpm doctor
jpm dev
```

`jpm install` 直接通过 Maven Wrapper 解析 Java 依赖，不安装 JavaScript 依赖。应用目录无需执行 `npm install`，也不需要 `node_modules` 或 npm lock 文件。

打开 `http://localhost:8080/`，得到：

```json
{"message":"Hello from jpm!"}
```

如果本机没有对应的 JDK，在 `jpm install` 之前运行：

```sh
jpm jdk install 21
```

不加 `-y` 时，交互终端会询问缺失的项目名和 Java 版本。第一版固定为 Spring MVC 模板；Spring Boot 版本从 Initializr 获取并写入项目配置。也可以通过 `--boot`、`--group` 和 `--package-name` 明确指定。

执行 `jpm create`，没有默认 JDK 配置时会看到以下文本问答：

```text
Project name (my-app): hello-spring
Java major version (21): 21
Creating hello-spring from Spring Initializr…

Created /your/workspace/hello-spring

  cd hello-spring
  jpm install
  jpm dev
```

创建只生成文件，不自动安装依赖或启动应用。当前没有模板菜单、依赖勾选或 JDK 安装确认框。`jpm install` 会显示 Maven 下载和解析日志；`jpm dev` 会显示 Maven / Spring Boot 启动日志。缺少 JDK 时给出安装命令，需要用户执行后重试；服务启动后需要手动打开浏览器。

生成项目携带 `vendor/java-npm-0.1.0.tgz`。把归档与项目一起提交后，同事可在项目根目录执行 `npm install --global ./vendor/java-npm-0.1.0.tgz` 一次安装相同的 CLI，再使用 jpm 工作，不依赖原始 CLI 源码目录。首次安装工具仍可能下载它的 npm 依赖，首次解析 Java 依赖也可能访问 Maven 仓库；携带归档不代表全部依赖已离线备齐。

模板保留 `devDependencies.java-npm` 的相对归档引用和可选 npm 脚本别名，供已有 npm 工作流使用；jpm 主流程不依赖这些入口，也不生成 `postinstall` 钩子。

## 日常命令

在生成的应用目录运行：

| 命令 | 行为 |
| --- | --- |
| `jpm install` | 根据 JSON 同步 POM，通过 Maven `dependency:go-offline` 解析 Java 依赖 |
| `jpm dev` | 启动 Spring 应用，监听 Java / 资源文件变化，编译成功后触发 DevTools 重启 |
| `jpm test` | 运行 Maven 测试，包括生成的 HTTP 接口测试 |
| `jpm build` | 运行测试并生成 `target/` 下的可执行 JAR |
| `jpm sync` | 根据 JSON 更新 POM，不下载依赖 |
| `jpm list [--json]` | 只读列出 JSON 声明的直接 Java 依赖，无需 JDK 或网络 |
| `jpm tree` | 通过 Maven 显示实际解析的直接与传递依赖 |
| `jpm doctor [--json]` | 只读检查项目与环境，文本或 JSON 输出 |
| `jpm jdk` | 查看当前项目实际选中的 JDK |
| `jpm jdk list` | 列出检测到的已安装 JDK |
| `jpm jdk use 21` | 将项目 JDK 选择写入 `.jpmrc`，保留编译目标 |
| `jpm jdk use 21 --global` | 将用户默认 JDK 写入 `~/.jpmrc` |

Maven 参数通过 `--` 传递：

```sh
jpm build -- -DskipTests
jpm test -- -Dtest=JpmHelloTests
jpm dev -- -Dspring-boot.run.arguments=--server.port=8081
```

`jpm run dev|build|test` 是对应内置命令的别名。当前不执行任意 `package.json.scripts`；模板中的 npm 脚本仅为可选兼容入口。

## Java 依赖与配置

Java 依赖写在 `package.json.java.dependencies`；顶层 `dependencies` / `devDependencies` 属于 npm，`jpm install` 不处理它们。当前不读取独立的 `pkg.json`。新增依赖默认解析下载；移除依赖更新 JSON 和 POM：

```sh
jpm add org.apache.commons:commons-lang3@3.20.0
jpm add org.springframework.boot:spring-boot-starter-validation
jpm add org.assertj:assertj-core --scope test
jpm remove org.apache.commons:commons-lang3
```

`add` 会先验证配置、所选 JDK 与 Wrapper，再写入依赖。上述检查失败时不改 JSON / POM；Maven 下载或解析失败时保留已保存的声明，返回 Maven 的失败状态并提示 `jpm install` 重试或 `jpm remove` 移除。jpm 不自动回滚，以免覆盖后续编辑。保存 JSON / POM 时保留已有文件权限。

`list` 显示声明，不访问 Maven：没有显式版本的条目显示 `managed by Spring Boot`，JSON 输出的 `version` 为 `null`；这并不证明该坐标一定受 Boot 管理。`tree` 才显示 Maven 解析到的版本及传递依赖，需要可用 JDK / Wrapper，会同步受控 POM，缺少缓存时可能访问仓库。可以透传 Maven 的过滤和冲突信息参数：

```sh
jpm list --json
jpm tree -- -Dverbose
jpm tree -- '-Dincludes=org.apache.commons:*'
```

`--` 后的参数会原样传给 Maven，包括 `--help`。依赖树参数由 [Maven Dependency Plugin](https://maven.apache.org/plugins/maven-dependency-plugin/tree-mojo.html) 处理。

也可以直接编辑生成项目的 `package.json`：

```json
{
  "name": "my-app",
  "version": "0.0.1-SNAPSHOT",
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
      },
      "org.apache.commons:commons-lang3": "3.20.0"
    }
  }
}
```

示例展示 Spring Boot 4 的依赖命名；创建项目时保留 Initializr 对所选版本生成的真实依赖。修改后执行 `jpm install`，或用 `jpm sync` 只更新 POM。空对象表示版本由 Spring Boot 管理；其他依赖必须提供 Maven 的明确版本，不支持 npm 的 `^` / `~` 范围。依赖解析、传递依赖和版本管理由 Maven 执行，`package-lock.json` 只锁 npm 依赖，不锁 Java 依赖。

POM 是生成结果。jpm 通过内容摘要识别手工修改，发现冲突时停止并保留原文件；如需重新生成，请先备份，再删除旧 POM 并运行 `jpm sync`。现有任意 Maven 工程的导入、多模块、额外 BOM、插件、仓库配置尚不支持。需要这些能力时，可以继续用标准 Maven / IDE 管理生成的工程。

## 环境诊断

在应用根目录运行 `jpm doctor`。它一次列出 Node / 平台、JSON 配置、JDK 选择来源与路径、编译目标兼容性、当前终端环境、Maven Wrapper 和 POM 同步状态，并给出后续操作。

`doctor` 不修改文件、不安装 JDK、不调用 Maven、不访问网络；它会执行本机 `java` / `javac` 的版本检查。它不能验证仓库连通性或证明构建成功。`--json` 输出 `{ "ok": boolean, "checks": [...] }`，每项包含 `name`、`status`、`detail` 和可选的 `action`。存在 `error` 时退出 1，否则退出 0；终端 Java 与 jpm 选择不同只报告 `warn`，不会阻止 jpm 使用已验证的 JDK。

## JDK 与开发循环

新建项目会生成类似 npmrc 的 `.jpmrc`，可以提交到版本库：

```ini
# 项目使用的 JDK
java=21
```

第一版支持 `java=<主版本>`、空行、`#` / `;` 注释。未知字段、重复键、变量插值和 shell 命令都会报错。`jdk use` 更新配置时保留注释和权限，不覆盖符号链接。

从子目录首次执行 `jdk use` 时，新 `.jpmrc` 写入最近的 `package.json` / `.git` 所在目录；已有更近的 `.jpmrc` 仍优先。没有这些边界的独立目录写入当前目录，不越过用户目录去创建配置。

`.jpmrc` 选择运行 Maven 的 JDK；`package.json.java.version` 继续决定编译目标，两者可以不同。例如，`java=25` 可以使用 JDK 25 构建目标为 Java 21 的程序。切换 JDK 不再修改 `package.json` 或 POM。选择低于编译目标的 JDK 时，jpm 会在执行 Maven 前拒绝运行。

选择顺序为：显式命令版本 → 最近的项目 `.jpmrc` → 旧项目的 `package.json.java.version` → 用户 `~/.jpmrc`。项目配置向上查找，到 `package.json`、`.git` 或用户目录为止。保留旧项目的版本回退，是为了避免用户默认值意外改变已有工程的 JDK。创建新项目时没有旧项目回退，使用配置中的默认版本，最后回退到 Java 21；`--java` 始终优先。

`jdk use` 保存的是 jpm 的选择，Node 子进程不能修改父终端的环境。想让当前 bash / zsh 中的 `java`、`javac` 也切换，可以在项目目录运行：

```sh
jpm jdk use 21
eval "$(jpm jdk env)"
java -version
javac -version

# 只临时切换当前终端，不改配置文件
eval "$(jpm jdk env 25)"
```

安装 CLI 后，在应用目录内外均可使用 `jpm`。`jdk use` 的输出会提示通过 `jpm jdk env` 切换当前终端。

`jdk env` 成功时仅输出经过单引号转义的环境设置；重复执行会移除旧 `JAVA_HOME/bin` 和重复的目标 bin。jpm 不修改 `.zshrc` / `.bashrc`，不安装切目录自动切换 hook。用户默认值只影响 jpm 的选择，不会自动改变新开的终端。

JDK 检测覆盖 `JAVA_HOME`、jpm 本地缓存、SDKMAN 安装、macOS / Linux 常见安装目录和 `PATH` 中的 Java，且同时验证 `java` / `javac` 的主版本。`jdk list` 按真实路径去重。同一主版本下多个 vendor / build 的精确选择尚未提供，实际选中路径可通过 `jpm jdk` 查看。

有效且版本匹配的 `JAVA_HOME` 会先被采用，无需扫描其他目录或运行 PATH 中的 Java；可选安装目录不存在、不可读或不是目录时会跳过，不阻塞其他有效 JDK。

`jpm jdk install <major>` 从 Eclipse Adoptium 下载对应平台的 Temurin JDK，校验官方 SHA-256 与文件大小后安装到 `~/.jpm/jdks/<major>`。首次下载需要网络和磁盘空间；不会隐式安装 JDK，也不会覆盖已有的损坏安装。安装中断后的锁文件路径会显示在错误信息里，确认没有安装进程后可清理重试。

开发模式只监听 `src/main`。保存 Java / 资源文件后会串行编译并触发重启，编译失败后修改源码可重试。修改依赖、Java 版本或 Maven 配置后，请重启 `jpm dev`。生产构建仍使用标准 Spring Boot Maven 插件。

## 开发与验证

以下 npm 命令只用于开发、检查和打包 jpm 工具本身：

```sh
npm ci
npm run check
mkdir -p dist
npm pack --ignore-scripts --pack-destination dist
```

从源码试用时，也可以在当前终端定义别名后使用相同的 jpm 命令：

```sh
alias jpm='node /absolute/path/jpm/bin/jpm.js'
```

别名只对当前终端生效；共享给其他用户时使用上面的压缩包安装方式。

测试使用 Node 内置测试框架，覆盖 CLI、JSON/POM 语义与覆盖保护、下载/解压边界、JDK 版本和校验、Maven 参数/退出码及开发循环，以及真实本地 npm 打包和只读诊断。它们使用临时目录和模拟下载，不依赖网络。真实 Spring / JDK 端到端验证记录见 [VALIDATION.md](./VALIDATION.md)。

源文件按实际职责拆分：`cli.js` 处理命令入口，`create.js` 创建工程，`project.js` 管理 JSON/POM，`config.js` 管理 `.jpmrc`，`jdk.js` 管理 JDK，`maven.js` 管理构建与开发进程，`distribution.js` 准备可迁移的 CLI 压缩包，`doctor.js` 聚合只读检查。没有新增类或公共类型接口。仅引入 `fast-xml-parser` 和 `tar` 两个运行时依赖，分别处理 XML 和压缩包。

## 边界

- 仅支持新建单模块 Spring MVC 应用、Maven、macOS / Linux；Windows、Gradle、数据库和全栈模板留待后续。
- 尚未发布 npm 包；GitHub 仓库已创建，npm 名称归属仍需在正式发布前确认。
- Java 依赖和 Maven 插件从项目配置与现有 Maven settings 指定的仓库下载；网络或镜像不可用时会返回 Maven 的失败状态。
- JDK 安装测试与实际应用启动覆盖范围在验证记录中单独说明。

参考：[Spring Initializr](https://docs.spring.io/initializr/docs/current/reference/html/)、[Maven Wrapper](https://maven.apache.org/tools/wrapper/)、[Spring DevTools](https://docs.spring.io/spring-boot/reference/using/devtools.html)、[Adoptium API](https://api.adoptium.net/)。
