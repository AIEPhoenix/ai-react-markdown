# 包与环境要求

AI Markdown 支持 React 19 与 Vue 3.5。两个适配器共享解析引擎和核心协调逻辑，但组件、定制方式和生命周期遵循各自框架。

安装稳定版时可以不指定版本标签，让包管理器选择 `latest`。需要可复现的集成时固定版本并保留锁文件；测试预发布版时使用明确的候选版本。当前版本与兼容范围以包的 manifest 和[发布记录](release-highlights.md)为准。

## 选择包

| 包                                   | 直接安装的场景                       |
| ------------------------------------ | ------------------------------------ |
| `@ai-markdown/react`                 | React 应用                           |
| `@ai-markdown/vue`                   | Vue 应用                             |
| `@ai-markdown/react-mantine`         | 使用 Mantine 的 React 应用           |
| `@ai-markdown/core`                  | 为其他框架开发会话、规划与协调适配层 |
| `@ai-markdown/engine`                | 使用解析器、树转换或底层流式控制器   |
| `@ai-markdown/remark-mark-highlight` | 为独立 unified 流水线添加 `==高亮==` |

React 和 Vue 都依赖同版本的 core 与 engine；core 也依赖 engine。应用通常只需安装适配器及其 peer dependencies。Mantine 依赖兼容的 React 适配器，应一起升级。高亮插件独立发布，不与五个主包同步版本号。

仅使用公开入口。`@ai-markdown/react/plugins` 是 React 包的子路径，不是独立安装包。Vue 从根入口导出插件。各包提供 `/package.json`；不支持应用导入 `src/` 或内部 `dist/` 文件。

## 环境与样式

服务端和构建环境要求 Node `^20.19.0 || >=22.12.0`。CJS 产物依赖 Node 的 `require(ESM)` 能力，更早的 Node 20/22 可能报 `ERR_REQUIRE_ESM`。仓库开发使用 `.nvmrc` 和根 `package.json` 中固定的工具版本。

React 与 React DOM 要求 19，Vue 要求 `^3.5.0`，Mantine 集成使用 Mantine 9。渲染数学时，应用需要显式安装 KaTeX 并导入它的 CSS，不要依赖依赖提升带来的偶然可见性。

## 按框架开始

[React 快速开始](react-quick-start.md) · [Vue 快速开始](vue-quick-start.md) · [Mantine 快速开始](react-mantine-quick-start.md)

## API 差异

| 任务         | React / Mantine                          | Vue                                   |
| ------------ | ---------------------------------------- | ------------------------------------- |
| 传入内容     | `content={content}`                      | `:content="content"`                  |
| 自定义元素   | `customComponents`                       | `components` 或具名元素插槽，插槽优先 |
| 读取状态     | 上下文 Hooks                             | 组件属性和插槽上下文                  |
| 配置外观     | CSS、Typography、ExtraStyles、字号和主题 | 基础 CSS、class 与 style              |
| 光标         | 显式传入光标组件                         | 默认开启，可关闭或替换 cursor 插槽    |
| 平滑输出     | Hooks 接收当前配置对象                   | setup 组合式函数接收实时 getter       |
| 块缓存       | `blockMemo`                              | 不提供此属性                          |
| 孤立引用保护 | 渲染器属性与文档容器策略，默认 true      | 每个渲染器配置，默认 false            |

两者在客户端默认启用增量解析，都支持引擎插件、预处理器、清洗 schema 与 URL 转换，但不能假定所有属性和默认值相同。普通消息传入完整累积字符串，不要按网络片段拆成多个组件。

旧 `@ai-react-markdown/core` 是 React 渲染器，应迁移到 `@ai-markdown/react`，不能直接改成新的 `@ai-markdown/core`。详见[包迁移](framework-transition.md)。
