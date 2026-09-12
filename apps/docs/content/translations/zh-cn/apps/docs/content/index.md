# AI Markdown

在 React 和 Vue 中渲染 Markdown，包括逐步到达的 AI 回答。两个适配器共享解析引擎与文档协调能力，各自提供符合框架习惯的组件、定制接口和生命周期。

## 选择框架

| 应用              | 从这里开始                                              | 提供的能力                        |
| ----------------- | ------------------------------------------------------- | --------------------------------- |
| React 19          | [React 快速开始](guides/react-quick-start.md)           | 组件、Hooks 与自定义元素渲染      |
| Vue 3.5           | [Vue 快速开始](guides/vue-quick-start.md)               | 组件、作用域插槽与组合式函数      |
| React + Mantine 9 | [Mantine 快速开始](guides/react-mantine-quick-start.md) | 主题排版、代码高亮与 Mermaid 图表 |

需要比较依赖和运行环境时，查看[包与环境要求](guides/getting-started.md)。

## 构建流式界面

普通聊天消息应持续累积为一个字符串，并更新一个渲染器。应用负责网络传输、解码、取消和重试。阅读[流式输入](guides/streaming-input.md)，再使用 [React 聊天示例](guides/streaming-chat-example.md)或 [Vue 流式指南](guides/vue-streaming.md)。

只有在布局需要将同一逻辑文档分成多个组件时，才使用[文档协调](guides/documents-and-references.md)。它共享定义和脚注编号，不会拼接跨组件的代码块、公式或其他 Markdown 语法。

[打开交互示例](examples:)体验各框架目录，或在 [Playground](examples.md) 中输入自己的 Markdown。

## 定制与进阶

- [React 自定义组件](guides/custom-components.md)与 [Vue 组件和插槽](guides/vue-customization.md)。
- [Mantine 配置](reference/react-mantine.md)、[语法支持](guides/markdown-features.md)和[故障排查](guides/troubleshooting.md)。
- [渲染与性能](guides/rendering-and-performance.md)、[Core / Engine 契约](guides/api/core-engine-contracts.md)。
