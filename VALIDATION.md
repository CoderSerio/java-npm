# jpm 0.1 验证记录

日期：2026-11-11（Asia/Shanghai）。当前交付为可用压缩包分发的预览版，包名 `java-npm`、命令 `jpm`；个人 GitHub 仓库为 [CoderSerio/java-npm](https://github.com/CoderSerio/java-npm)，尚未发布 npm 包。

## 首版交互更正：统一使用 jpm

首次安装 CLI 后，日常流程为 `jpm create → jpm install → jpm dev`。创建输出、生成的 README、CLI 帮助与错误恢复、doctor / JDK 提示均使用 jpm。npm 仅用于安装 / 分发 CLI 工具及可选兼容入口，不是 Java 工程的必经步骤；`jpm install` 直接调用 Maven，不隐式安装 JavaScript 依赖。

新模板移除 npm `postinstall` 钩子，保留可选脚本别名和相对 CLI 归档，方便共享工具。没有改写此前生成的工程。无新增文件、类、接口或依赖，版本保持未发布的 `0.1.0`。

相关 CLI、create、doctor 测试 **21/21 通过**。真实验收将归档安装到隔离临时 npm prefix，把该 prefix/bin 放在测试进程 PATH 中，没有修改真实全局安装或 shell 配置：

| 操作 | 实际观察结果 |
| --- | --- |
| `jpm create hello-spring --java 21 -y` | 调用真实 Initializr，输出后续 `jpm install` / `jpm dev`；模板无 postinstall |
| `jpm install` | 直接完成 Maven 依赖解析，退出 0 |
| `jpm doctor` | 项目检查退出 0 |
| `jpm dev -- -Dspring-boot.run.arguments=--server.port=<临时端口>` | 实际 HTTP 200，响应 `{"message":"Hello from jpm!"}` |
| Ctrl-C | CLI 退出 130，HTTP 端口关闭 |
| 检查应用目录 | 从创建到停止服务均无 node_modules、package-lock.json；应用中没有执行 npm 安装 |

Java 验收复用已有 Maven 缓存并使用 `MAVEN_ARGS=-o`；当前只在 macOS 上验证，不代表跨平台或冷缓存验收。以下保留历史测试记录，其中 npm 作为日常入口的部分已由本节更正。

## 首版开发增量：依赖查询与失败处理

新增 `jpm list [--json]` 查看 JSON 声明的直接依赖、`jpm tree [-- <Maven 参数>]` 查看 Maven 解析树。list 无需 JDK / 网络，不同步 POM；tree 复用既有 JDK、POM 与 Maven 执行路径。修复 `--` 后的 `--help` 被 CLI 截获的问题。

`add` 在保存之前检查配置、JDK 兼容性和可执行 Wrapper；预检失败不修改 JSON / POM。Maven 解析失败后保留声明和退出状态，明确显示重试 / 移除命令，不自动覆盖用户后续编辑。原子写入现在保留 JSON / POM 权限并继续拒绝符号链接。

修复子目录首次 `jdk use` 的落盘位置：使用最近的 package / 仓库边界，保留显式的更近 rc 和用户目录边界。有效 JAVA_HOME 优先，跳过不存在、不可读或非目录的可选安装路径。

本轮沿用现有文件，无新增文件、类或运行时依赖。`maven.js` 导出现有 `wrapperPath` 供 add 预检复用；CLI、配置、JDK、项目写入模块及已有测试同步更新。首版仍在开发，包版本统一为 `0.1.0`；此前使用的 `0.1.1` 只是未发布的测试标记，已撤回。

完整 `npm run check` 在 **Node 24.18.0 / npm 11.16.0** 与 **Node 22.23.1 / npm 10.9.8** 均为 **57/57 通过**，无跳过。新增回归覆盖 list 的只读输出、tree 参数/退出码、add 失败状态、权限与符号链接、子目录配置和候选 JDK 的错误边界。跨版本运行时 PATH 均使用对应 Node/npm。

以下保留当时的真实测试记录，不代表曾发布版本。真实增量验收从前一轮生成的项目复制到新的临时目录，保留原始 JSON / npm lock / vendor，删除 node_modules 和 target 后，通过 `npm install --save-dev ./vendor/java-npm-0.1.1.tgz` 升级。安装后的版本返回 `0.1.1`，项目与 lock 引用新的相对归档；该命令没有触发根项目的 Maven postinstall，Java 链路由后续命令单独验证。

| 操作 | 实际观察结果 |
| --- | --- |
| `list --json` | 返回声明的直接依赖，Boot 管理的版本为 null |
| 删除根 `.jpmrc`，在 src/main 执行 `jdk use 21` | 根目录生成 rc，src/main 未生成 rc |
| 目标 Java 21，选择 JDK 17 后 add | 退出 1，JSON / POM 字节不变 |
| 将临时项目 mvnw 暂时替换为目录后 add | 预检退出 1，JSON / POM 字节不变；随后恢复 Wrapper |
| 设置有效 JAVA_HOME，同时令 SDKMAN_CANDIDATES_DIR=/dev/null | JDK 选择、依赖解析、tree 和测试均成功 |
| JSON 设为 0600、POM 设为 0640 后 add/remove | 添加 Commons Lang 3.16.0 成功，JSON / POM 权限始终保留 |
| `tree -- '-Dincludes=org.apache.commons:*' -Dverbose` | Maven 显示 `org.apache.commons:commons-lang3:jar:3.16.0:compile` |
| add 一个不受 Boot 管理且无版本的测试坐标 | Maven 真实模型校验失败，退出 1，声明保留，显示重试 / 移除说明；remove 后恢复 |
| 恢复后 doctor 和 `jpm test` | doctor 退出 0，Spring 上下文 / HTTP 测试 2/2 通过 |

Java 验收使用 `MAVEN_ARGS=-o` 和前轮已有的 Maven 缓存，验证版本为 Spring Boot 4.1.2 / Maven 3.10.0 / Zulu 21.0.11；不代表冷缓存离线安装。当前轮未重复 Initializr 在线创建、JDK 下载或开发热更新验收，相关历史证据见下面各节。

## 分发与 doctor 增量

包元信息和 lock 元信息统一为 `java-npm`，npm 仅暴露 `jpm` 一个命令。创建项目时，将当前 CLI 打包到项目的 `vendor/java-npm-0.1.0.tgz`，使用相对 `file:vendor/…` 依赖。`bin/create-jpm.js` 仅保留直接文件调用兼容，不再注册为 npm 命令。

新增 `src/distribution.js` / `test/distribution.test.js`，分别负责本地离线打包与归档内容、拒绝覆盖测试；新增 `src/doctor.js` / `test/doctor.test.js`，分别负责聚合只读检查与健康、失败、POM、shell 场景测试。函数入口为 `packCli`、`inspectDoctor`；现有 `project.js` 增加 `inspectPom` 复用手工修改检测。无新增类、类型接口或运行时依赖。

`doctor` 检查 Node / 平台、JSON、配置来源、JDK / 编译目标、shell 环境、Wrapper 与 POM；支持文本 / JSON，错误退出 1，只有警告时退出 0。不访问网络、不运行 Maven、不修复配置。

本轮完整 `npm run check` 在 macOS arm64 的 **Node 24.18.0 / npm 11.16.0** 与 **Node 22.23.1 / npm 10.9.8** 均为 **48/48 通过**，无失败、无跳过。Node 22 的 PATH 同时指向该版本，保证测试派生的 Node/npm 进程使用相同运行时。

真实预览包验收使用 Spring Boot **4.1.2**、Wrapper Maven **3.10.0** 和本机 Zulu JDK **21.0.11**：

| 操作 | 实际观察结果 |
| --- | --- |
| 将本地 tarball 安装到隔离 npm prefix | 安装目录是普通目录而非源码符号链接；仅注册 `jpm` 命令 |
| 用安装后的 CLI 调用 Initializr 创建项目 | 真实生成应用，并从已安装的 CLI 再打包 `vendor/java-npm-0.1.0.tgz` |
| `npm install` | 从项目内相对归档安装 CLI；Maven postinstall 成功 |
| `jpm add org.apache.commons:commons-lang3@3.16.0` | JSON、POM 和 Maven 解析均包含该依赖，npm devDependency 保持不变 |
| Java Controller 调用 `StringUtils.capitalize` | 确认新增库实际参与编译，而非只检查配置文本 |
| 删除初始 prefix、外部输入 tarball 和应用 `node_modules`，再移动应用目录 | 新目录 `npm ci` 成功；package.json 和 package-lock.json 无临时目录或用户源码绝对路径 |
| 移动后 `npm run build` | 真实 Spring 上下文 / HTTP 测试 2/2 通过，生成的 JAR 包含 `commons-lang3-3.16.0.jar` |
| `doctor --json` | 正常工程退出 0；终端 PATH Java 与选择不同报告 warn，未阻止有效 JDK 构建 |
| 仅修改 JSON / 手改 POM 后分别运行 doctor | 均退出 1，分别报告 POM 过期 / 手工修改；核对项目关键文件字节和 mtime 未改变 |
| 恢复 Controller 后 `jpm remove org.apache.commons:commons-lang3` | JSON、POM 同时移除直接依赖，npm 依赖与 scripts 保留 |
| 独立目录 `npm exec --package=<tarball> -- jpm --version` | 使用已缓存依赖返回 `0.1.0` |

这是同一台 macOS 机器上的目录迁移验证，npm 与 Maven 缓存可复用，不等同于全新机器的冷缓存或离线安装验收。npm 验收通过命令参数选择官方 registry，未改用户 npm 配置；默认企业 registry 的一次离线检查因没有该来源缓存而失败，切换到已有缓存的官方来源后通过。doctor 的只读快照覆盖 package.json、POM、.jpmrc、npm lock 和 Wrapper 文件。

本轮未重新测试开发热更新或下载 JDK；以下各节保留此前已完成的验证及其证据范围。

## .jpmrc 与 JDK 切换增量

新增项目 `.jpmrc` / 用户 `~/.jpmrc` 配置、`jdk list`、`jdk use <major> [--global]` 和 `jdk env [major]`。项目 JDK 选择与编译目标分开，旧项目保留 `package.json.java.version` 回退；从子目录操作时使用相同项目边界。无新增运行时依赖。

新增 `src/config.js` 用于受限 npmrc 语法的解析、分层读取和原子写入；新增 `test/config.test.js` 验证优先级、目录边界、注释/权限保留和覆盖保护。现有 `jdk.js` 增加 `listJdks` / `shellEnvironment` 函数，CLI、脚手架、测试和 README 同步更新。无新增类或类型接口。

增量自动化检查共 **41 项**，覆盖项目与用户配置隔离、shell exports 转义、PATH 重复切换稳定性、低于编译目标的 JDK 拒绝，以及子目录中的旧项目回退。增量检查运行于 Node 26.8.1；下表中的 Node 22 结果属于初版 28 项测试。

真实增量验证：在独立临时项目中，将编译目标设为 Java 17，再执行 `jdk use 21`，确认只有 `.jpmrc` 更新，JSON 和 POM 保持原样。分别在不加载个人配置的 bash / zsh 中应用 `jdk env`，实际 `java` / `javac` 都为本机 Zulu 21.0.11；重复执行后 PATH 完全一致。随后通过该配置运行真实 Maven HTTP 测试，检查生成的 Controller class 主版本为 **61（Java 17）**。

JDK 17 / 21 / 25 之间的选择、全局配置隔离和错误分支由临时模拟 JDK 覆盖；本次真实 shell/Maven 验证使用本机已有 JDK 21，没有额外下载其他 JDK。临时工程已清理，未修改真实 `~/.jpmrc`、`.zshrc` 或 `.bashrc`。自动随目录切换及同主版本内 vendor/build 的精确选择未实现。

## 初版自动化测试

| 环境 | 命令 | 结果 |
| --- | --- | --- |
| macOS arm64 / Node 26.8.1 | `npm run check` | 28/28 通过，包含入口语法检查 |
| macOS arm64 / Node 22.23.4 | `node --test` | 28/28 通过，无跳过 |
| 本地 npm 打包检查 | `npm pack --dry-run --json` | 成功，两个可执行入口与运行模块均被收录 |

测试覆盖配置校验、POM 版本管理与手工修改保护、依赖更新时保留 scope/optional、官方模板依赖解析、目录覆盖保护、压缩包路径与大小校验、JDK 校验与缓存、Maven 参数透传、退出码和子进程清理、串行重编译、删除清理及失败恢复。下载和进程场景使用模拟响应或临时可执行文件。

## 真实外部服务与应用验证

从 Spring Initializr 创建真实 Maven 工程，选择 Java 21，服务当时默认 Spring Boot 4.1.2，官方 Wrapper 下载 Maven 3.10.0。应用运行使用本机已有 Zulu JDK 21.0.11。

| 操作 | 实际观察结果 |
| --- | --- |
| `create-jpm demo -y` | 获取真实元数据与项目归档，生成 JSON、受控 POM、官方 Wrapper、Controller 与测试 |
| `npm install` | `postinstall` 调用 Maven `dependency:go-offline`，下载依赖后退出 0 |
| `npm test` | Spring 上下文测试与真实 HTTP 接口测试共 2 项通过 |
| `npm run build` | 测试通过，生成可执行 `demo-0.0.1-SNAPSHOT.jar` |
| `java -jar … --server.port=<临时端口>` | GET `/` 返回 `{"message":"Hello from jpm!"}` |
| `npm run dev -- -- -Dspring-boot.run.arguments=--server.port=<临时端口>` | 启动成功，Maven 参数正确传递 |
| 修改 Controller 返回内容 | 不手动重启即可观察到新的 HTTP 响应 |
| 引入 Java 语法错误，再修复保存 | 输出编译失败提示，修复后自动恢复正确响应 |
| 新增、删除另一个 Controller | 新路由先返回 200，删除后返回 404，未残留旧 class 路由 |
| Ctrl-C | npm dev 返回 130，HTTP 端口关闭 |
| 从最终 `idea-lab/jpm` 目录重新创建 | 成功，生成项目引用最终目录的本地 `create-jpm` 包 |

此外，真实调用 Adoptium 下载了 Temurin **21.0.13+9 / macOS arm64**，归档大小 **199,754,598 bytes**。安装器核对官方 SHA-256 和大小后解压，实际运行 `java` 与 `javac` 均返回 **21.0.13**；再次安装命中缓存，并在禁止网络的测试回调下成功。验证所用 JDK 放在独立临时目录，结束后已清理，没有改变全局 Java 选择。

## 新增文件及理由

| 文件 | 用途 |
| --- | --- |
| `bin/jpm.js`、`bin/create-jpm.js` | 前者注册 `jpm` npm 命令，后者保留初版的直接文件调用兼容 |
| `src/cli.js` | 解析命令、衔接项目配置、JDK 与 Maven |
| `src/create.js` | 调用 Initializr，安全解压并生成可启动的示例工程 |
| `src/project.js` | 校验 JSON、生成 POM、管理依赖并保护手工改动 |
| `src/jdk.js` | 检测、选择和校验安装 JDK |
| `src/maven.js` | 运行 Wrapper、管理进程和开发重编译循环 |
| `test/cli.test.js` | 验证命令行为和依赖更新语义 |
| `test/create.test.js` | 验证工程创建与归档边界 |
| `test/project.test.js` | 验证 Maven 语义、输入校验和覆盖保护 |
| `test/jdk.test.js` | 验证 JDK 选择、安装校验及失败清理 |
| `test/maven.test.js` | 验证参数、信号、进程清理与重编译恢复 |
| `package.json`、`package-lock.json` | 声明并锁定 CLI 的 npm 依赖、入口和运行环境 |
| `.gitignore` | 排除依赖、临时打包产物和系统文件 |
| `README.md`、`VALIDATION.md` | 提供本地用法、边界和可复核的验证结果 |

无新增类或公共类型接口。运行时只新增 XML 解析与 tar 解压两个直接依赖。

## 未覆盖与限制

- Linux 代码路径有模拟测试，未在 Linux 实机运行；Windows 不受本版本支持。
- 没有验证任意 Maven 工程、额外插件/BOM、Gradle、多模块、数据库和全栈模板；这些不属于第一版范围。
- 包保持 `private: true`，未发布 npm。`java-npm` 的 registry 查询在本轮返回 404，但不保证正式发布时可注册。生成项目携带相对路径 CLI 归档，仍需对应平台的 Node/JDK 以及 npm/Maven 依赖来源。
- Java 依赖解析仍受 Maven 仓库、现有 settings 和网络影响；首次下载耗时明显高于缓存命中的运行。
- 开发模式通过轮询扫描 `src/main`，适用于当前单模块原型；大型项目的性能没有测量。
