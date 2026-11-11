# Announcement drafts

**Use only after the alpha is published, installed from npm, and the repository is publicly accessible.** Check the exact version and links before posting. These are drafts, not evidence of publication.

## 中文

我做了一个面向 Java / Spring Boot 的命令行工具：**jpm**，全称 java-npm。第一个 alpha 版本现在可以通过 npm 安装了。

想法很直接：用 `create`、`add`、`dev`、`test`、`build` 这一组熟悉的命令完成日常开发，把 Java 依赖写在 `package.json` 里。jpm 生成标准 POM，依赖解析和构建仍然交给 Maven。

```sh
npm install --global java-npm@alpha
jpm create my-app --java 21 -y
cd my-app
jpm install
jpm dev
```

需要 Node 26+、macOS/Linux 和 JDK 21；没有合适 JDK 时，可以显式执行 `jpm jdk install 21`。初次创建和下载依赖需要联网。

这一版聚焦新建的单模块 Spring MVC 项目，也提供 JDK 选择、依赖查看和 `doctor` 环境检查。Windows、Gradle、多模块以及任意现有 Maven 项目的导入还不在支持范围内。Alpha 阶段的命令和配置可能调整，欢迎带着具体场景来试用和反馈。

- 源码与文档：[CoderSerio/java-npm](https://github.com/CoderSerio/java-npm)
- npm：[java-npm](https://www.npmjs.com/package/java-npm)
- 许可证：MIT

## English

I've been building **jpm (java-npm)**, a CLI for Java and Spring Boot. The first alpha is now available on npm.

It brings familiar `create`, `add`, `dev`, `test`, and `build` commands to a Java workflow. Declare Java dependencies in `package.json`; jpm generates a standard POM, and Maven handles dependency resolution and builds.

```sh
npm install --global java-npm@alpha
jpm create my-app --java 21 -y
cd my-app
jpm install
jpm dev
```

You'll need Node 26+, macOS/Linux, and JDK 21. If needed, explicitly install the JDK with `jpm jdk install 21`. Initial project creation and dependency downloads require network access.

This alpha focuses on new single-module Spring MVC projects. It also includes JDK selection, dependency inspection, and a `doctor` command. Windows, Gradle, multi-module builds, and arbitrary existing Maven project imports are outside its current scope. Commands and configuration may change during alpha; concrete bug reports and workflow feedback are welcome.

[Source and docs](https://github.com/CoderSerio/java-npm) · [npm package](https://www.npmjs.com/package/java-npm) · MIT licensed
