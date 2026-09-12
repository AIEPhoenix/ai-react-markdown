# React 组件与类型参考

React 19 适配器，从 `@ai-markdown/react` 默认导入 AIMarkdown。它负责 React 生命周期、上下文、文档协调与元素缓存；共享 core 和 engine 负责解析及通用编排。

## 安装与基本用法

见 [React 快速开始](../guides/react-quick-start.md)。内置排版需要导入 typography/default.css，数学需要单独导入 KaTeX CSS。服务端与构建环境要求 Node `^20.19.0 || >=22.12.0`，react 与 react-dom peer 为 19。

完整基础配置见 [19 项属性参考](../guides/api/react-props.md)，默认值与类型以该页为准。

## 公开组件

- AIMarkdown：渲染完整累积字符串。
- AIMarkdownSmoothStream：继承基础属性，并添加平滑速度、排空回调、等待和文档协调配置，见[平滑输出](../guides/smooth-streaming.md)。
- AIMarkdownStreamingCursor：测量文本末尾并挂载视觉指示器，可通过 indicator 定制，见[光标](../guides/streaming-cursor.md)。
- AIMarkdownDocuments：管理同一范围内的文档 registry 与平滑协调器，不添加排版 DOM。

## 文档容器与 registry

文档容器接收 children、preserveOrphanReferences（默认 true）及 smoothTurnTaking（默认 true）。孤立引用策略无条件覆盖内部片段，平滑开关控制整个范围的轮流呈现。

不能嵌套容器：开发环境抛错，生产环境记录错误并让内部子树继续使用外层容器。

`useDocumentRegistry(documentId, documentIdExplicit = true)` 返回只读 Registry；没有容器、ID 为空或 explicit=false 时返回 null。该 Hook 本身不注册片段，也不订阅 registry 的内容更新。使用 useSyncExternalStore 管理响应式读取和退订，见[文档协调](../guides/cross-chunk-coordination.md)。

## 排版与自定义组件

Typography 接收 className、style 和 children。务必合并注入的 style，保留字号根变量。ExtraStyles 位于排版与正文之间。自定义元素组件需保留 children、语义属性和可访问性，并自行负责它产生的 URL 和应用输出。

AIMarkdownProps 支持元数据泛型。主题、行为、管线与扩展组类型从根入口导出；插件对象从 `/plugins` 子路径导入。请勿导入内部 src/dist 文件。

## 共享辅助接口

根入口导出 URL 默认策略、schema 扩展、预处理器、平滑控制器及相关类型。封闭插件目录默认全启用，传入数组替换集合，不能注入任意 remark/rehype 插件。

[Hooks 与 Provider](../guides/api/react-hooks.md) · [URL 与清洗](../guides/url-sanitization.md) · [SSR](../guides/react-ssr.md) · [英文完整参考](english:docs/react/)
