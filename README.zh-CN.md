<p align="center">
  <img src="assets/brand/jpm-readme.png" alt="jpm" width="360">
</p>

<p align="center"><strong>用熟悉的 npm 风格工作流开发 Java 和 Spring Boot。</strong></p>

<p align="center">
  <a href="https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml"><img src="https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A526-004c34" alt="Node.js 26 或更新版本"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/status-alpha-27cd77" alt="Alpha"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-004c34" alt="MIT 许可"></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/README.md">文档</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="README.md">English</a>
</p>

---

**jpm** 把前端开发者熟悉的命令带到 Java：创建应用、添加依赖、启动开发、构建 JAR。Java 依赖写在 `package.json` 中，jpm 生成 POM，并通过项目的 Maven Wrapper 执行构建。

Spring Initializr 提供初始工程，Maven 负责依赖解析和构建。最终应用在 JVM 上运行，无需 Node.js 运行环境。

- **从可运行的应用开始。** 创建包含 HTTP 接口和测试的 Spring MVC 工程。
- **清晰地声明依赖。** 在 JSON 中维护 Maven 坐标、同步 POM，并保护手工修改不被覆盖。
- **保存后编译、重启。** `jpm dev` 监听 Java 和资源文件，编译改动，通过 Spring DevTools 重启应用。
- **按项目选择 Java。** 提交一份 `.jpmrc`，选择已安装的 JDK，用 `jpm doctor` 排查配置问题。

> **Alpha 阶段：** 当前聚焦 macOS 和 Linux 上新建的单模块 Spring MVC 项目，命令与配置可能调整。

## 快速开始

在 macOS 或 Linux 上准备 **Node.js 26+** 和 **JDK 21**，无需另外安装 Maven。

<!-- publication-status:start -->
首个 npm alpha 正在准备中。以下 registry 安装命令在发布后可用；现在可以[从源码构建](CONTRIBUTING.md#development-setup)体验。
<!-- publication-status:end -->

```sh
npm install --global java-npm@alpha
jpm create my-app --java 21 -y
cd my-app
jpm install
jpm dev
```

打开 **<http://localhost:8080/>** 查看生成应用的响应。修改 Java Controller 并保存，即可观察开发模式下的自动重启。

还没有 JDK？先执行 `jpm jdk install 21`，再执行 `jpm install`。JDK 下载需要显式触发；创建工程不会安装工具或依赖。首次使用需要联网获取未缓存的资源。

npm 包名是 **`java-npm`**，安装后的命令是 **`jpm`**。

## 熟悉的开发循环

```sh
jpm add org.springframework.boot:spring-boot-starter-validation
jpm test      # 运行应用测试
jpm build     # 测试并打包可执行 JAR
```

`jpm list` 查看直接依赖声明，`jpm tree` 查看解析后的依赖树，`jpm doctor` 检查环境。Maven 参数放在 `--` 后，例如 `jpm build -- -DskipTests`。

[查看完整 CLI 用法 →](docs/cli.md)

## 用 JSON 声明 Java 依赖

通过 `jpm add` 添加依赖，或编辑工程 `package.json` 中的 `java.dependencies`：

```json
{
  "java": {
    "dependencies": {
      "org.springframework.boot:spring-boot-starter-validation": {},
      "org.assertj:assertj-core": { "scope": "test" }
    }
  }
}
```

以上是配置片段。空对象使用 Spring Boot 管理的依赖版本；其他依赖需要明确指定 Maven 版本。修改后运行 `jpm install`，同步 POM 并解析依赖。

npm 用于分发 CLI；`jpm install` 通过 **Maven 解析 Java 依赖**。每位开发者单独安装 jpm，生成工程不携带 CLI 归档。

[阅读配置指南 →](docs/configuration.md)

## 文档

[命令参考](docs/cli.md) · [配置与 JDK 选择](docs/configuration.md) · [故障排查](docs/troubleshooting.md) · [架构](docs/architecture.md) · [路线图](docs/roadmap.md)

Alpha 支持新建的单模块 Maven 项目。现有 POM 导入、Gradle、Windows、多模块、JSON 中的自定义 BOM/插件以及 Java 依赖锁定不在当前范围内。已测试的环境与限制见[验证记录](VALIDATION.md)。

## 参与贡献

欢迎提交缺陷复现、文档改进和范围明确的代码改动。请先阅读[贡献指南](CONTRIBUTING.md)，再使用 Issue 或 PR 模板。中英文均可。

[行为准则](CODE_OF_CONDUCT.md) · [私密报告安全漏洞](SECURITY.md)

## 许可证

[MIT](LICENSE) © 2026 Carbon 与贡献者。

jpm 是独立项目，与 Java、npm、Maven 和 Spring 项目无隶属关系。
