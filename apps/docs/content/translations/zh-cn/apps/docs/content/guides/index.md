# 指南目录

首次接入从[文档概览](../index.md)选择框架，依赖比较见[包与环境要求](getting-started.md)。React 与 Vue 的组件和生命周期不同，请沿对应框架阅读。

## 应用开发

- [React 快速开始](react-quick-start.md)、[流式聊天](streaming-chat-example.md)、[定制组件](custom-components.md)、[SSR](react-ssr.md)。
- [Vue 快速开始](vue-quick-start.md)、[流式输出](vue-streaming.md)、[文档协调](vue-documents.md)、[定制](vue-customization.md)、[SSR](vue-ssr.md)。
- [Mantine 快速开始](react-mantine-quick-start.md)、[代码与图表](mantine-code-blocks.md)。

## 共同概念与进阶

[流式输入](streaming-input.md) · [文档与引用](documents-and-references.md) · [性能](rendering-and-performance.md) · [语法支持](markdown-features.md) · [URL 与 HTML](url-sanitization.md) · [预处理](content-preprocessors.md) · [故障排查](troubleshooting.md)

新框架适配器从 [Core / Engine 契约](api/core-engine-contracts.md)和[适配器教程](building-an-adapter.md)开始。React 设计系统包装器阅读[开发 React 集成](extending-via-subpackage.md)。

## 贡献与版本

[开发命令](development-commands.md) · [架构](architecture.md) · [核心测试](core-testing.md) · [Soak](soak-coverage.md) · [基准方法](benchmarking.md) · [Storybook](storybook.md) · [文档维护](documentation-site.md) · [发布](releasing.md)

公共 API 从 3.0.0 起遵循语义化版本；兼容更新可能改变默认视觉值，应固定自己依赖的配置。内部逐字节 HTML 不是应用稳定接口，优先断言语义与可访问结构。历史配置和测量请结合[发布记录](release-highlights.md)中的版本解读。
