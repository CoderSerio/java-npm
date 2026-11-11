<div align="center">

<img src="assets/brand/jpm-readme.png" alt="jpm — 咖啡豆与终端标识" width="480">

# jpm

**用熟悉的命令行流程开发 Java 与 Spring Boot 应用。**

[![CI](https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml/badge.svg)](https://github.com/CoderSerio/java-npm/actions/workflows/ci.yml)
[![Node.js 26+](https://img.shields.io/badge/node-%E2%89%A526-417e38)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Alpha](https://img.shields.io/badge/status-alpha-orange)](CHANGELOG.md)

[English](README.md) · [文档](docs/README.md) · [贡献指南](CONTRIBUTING.md) · [路线图](docs/roadmap.md)

</div>

jpm 为 Java 项目提供 `create`、`add`、`dev`、`test` 和 `build` 命令，用 `package.json` 声明 Java 依赖，生成标准 Maven POM，并调用项目自带的 Maven Wrapper。Spring Initializr 提供模板，依赖解析和构建仍由 Maven 完成。

npm 包名是 **`java-npm`**，安装后的命令是 **`jpm`**。

> **Alpha 发布候选：** 当前版本为 `0.1.0-alpha.0`，正在准备首次 npm 发布。下方 registry 安装命令在发布完成后可用。alpha 阶段的命令和配置仍可能调整。

## 为什么做 jpm？

- **熟悉的命令。** 用同一个 CLI 创建 Spring MVC 应用、添加依赖、启动开发服务。
- **可读的配置。** 在 `package.json` 中编辑 Maven 坐标；jpm 同步 POM，并检测对生成文件的手工修改。
- **明确的 JDK 选择。** 用项目 `.jpmrc` 固定主版本，查看已有安装，或显式下载经过校验的 Temurin JDK。
- **连贯的开发循环。** Java 和资源文件改动触发编译与 DevTools 重启；`doctor` 汇总环境问题和处理建议。
- **标准构建结果。** Maven 生成可执行 Spring Boot JAR，Java 应用运行时不依赖 Node.js。

## 快速开始

需要 **macOS 或 Linux、Node.js 26+**。以下示例使用 **JDK 21**；无需预装 Maven。

alpha 发布后安装：

```sh
npm install --global java-npm@alpha
jpm --version
jpm create my-app --java 21 -y
cd my-app
```

如果没有 JDK 21，先显式执行 `jpm jdk install 21`。然后运行：

```sh
jpm install
jpm doctor
jpm dev
```

打开 <http://localhost:8080/>：

```json
{"message":"Hello from jpm!"}
```

创建命令只生成文件，不安装依赖或启动服务。首次调用 Initializr、安装 npm 包、解析 Maven 依赖及可选的 JDK 下载需要网络；已有缓存可减少下载。

**发布前试用源码：** 按[开发环境说明](CONTRIBUTING.md#development-setup)构建后，运行 `node /absolute/path/java-npm/bin/jpm.js`，或安装 `npm pack` 生成的压缩包。

## 日常使用

```sh
jpm add org.springframework.boot:spring-boot-starter-validation
jpm list
jpm tree
jpm test
jpm build
```

| 命令 | 行为 |
| --- | --- |
| `jpm create <name>` | 从 Initializr 创建 Spring MVC 项目 |
| `jpm install` | 同步 POM，并通过 Maven 解析 Java 依赖 |
| `jpm add <group:artifact[@version]>` | 保存并解析 Java 依赖 |
| `jpm remove <group:artifact>` | 删除依赖声明并更新 POM |
| `jpm dev` | 监听、编译并重启开发服务 |
| `jpm test` / `jpm build` | 运行测试 / 测试并打包 JAR |
| `jpm list` / `jpm tree` | 查看声明的 / 实际解析的依赖 |
| `jpm doctor` | 检查配置、JDK、Wrapper 和 POM |
| `jpm jdk` | 查看、安装或选择 JDK |

用 `--` 透传 Maven 参数，例如 `jpm build -- -DskipTests`。完整选项见[命令参考](docs/cli.md)。

## 配置与构建

```text
package.json → 生成 pom.xml → Maven Wrapper → 测试 / 可执行 JAR
    .jpmrc  → 选择 JDK ──────────┘
```

Java 依赖写在 `java.dependencies`，不是 npm 的顶层 `dependencies`：

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

这只是生成配置的一部分。空对象表示请求 Spring Boot 的版本管理；不受 Boot 管理的依赖需要明确的 Maven 版本。完整格式见[配置文档](docs/configuration.md)。

npm 用于分发 CLI。**`jpm install` 解析 Java 依赖，不执行 `npm install`。**生成项目不附带 jpm 归档，也不声明 jpm 的 npm 依赖；团队成员单独安装工具即可。

## 当前范围

alpha 支持 **macOS/Linux 上新建的单模块 Spring MVC + Maven 项目**。尚不支持任意已有 POM 导入、Windows、Gradle、多模块、自定义 BOM，以及 JSON 中的额外插件和仓库声明。

Java 依赖仍由 Maven 解析，jpm 尚未提供 Java 依赖锁文件。JDK 按主版本选择，不固定到具体 vendor/build。详情见[范围与路线图](docs/roadmap.md)、[问题排查](docs/troubleshooting.md)。

## 参与贡献

欢迎提供可复现的 bug、文档改进和范围明确的代码修改。请阅读[贡献指南](CONTRIBUTING.md)，使用 issue/PR 模板，并向 `main` 提交 PR。社区遵循[行为准则](CODE_OF_CONDUCT.md)。

安全问题请按 [SECURITY.md](SECURITY.md) 私下反馈。实际验证范围记录在 [VALIDATION.md](VALIDATION.md)。

## 许可证

[MIT](LICENSE) © 2026 Carbon and contributors。jpm 是独立项目，与 Java、npm、Maven、Spring 项目没有隶属关系。
