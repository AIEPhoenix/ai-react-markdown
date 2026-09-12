# Vue API 参考

从 `@ai-markdown/vue` 导入 AIMarkdown（默认或具名）、AIMarkdownDocuments、AIMarkdownSmoothStream、AIMarkdownStreamingCursor，以及两个平滑组合式函数。Vue 要求 `^3.5.0`，服务端与构建环境要求 Node `^20.19.0 || >=22.12.0`。

## 组件属性

| 属性                     | 默认值               | 契约                            |
| ------------------------ | -------------------- | ------------------------------- |
| content                  | 必填                 | 完整累积字符串                  |
| streaming                | false                | 生产端生成状态                  |
| components               | 未设置               | HTML 标签到 Vue 组件的只读映射  |
| metadata                 | 未设置               | 传给自定义组件和插槽的应用数据  |
| documentId               | useId 生成           | 协调时使用共享显式字符串        |
| documentIndex            | 未设置               | 文档片段的稳定顺序              |
| enginePlugins            | defaultEnginePlugins | 封闭插件集合，传入数组整体替换  |
| contentPreprocessors     | 未设置               | 内置 LaTeX 处理后追加的预处理器 |
| sanitizeSchema           | 默认 schema          | HTML 清洗策略                   |
| urlTransform             | defaultUrlTransform  | 最终 URL 策略                   |
| incrementalParse         | true                 | 客户端增量解析，服务端完整解析  |
| preserveOrphanReferences | false                | 每个渲染器的孤立定义保护策略    |
| streamingCursor          | true                 | 是否显示内置测量光标            |

Vue 不提供 React 的 blockMemo、Typography、ExtraStyles、variant 或 React 上下文 Hooks。使用基础 CSS 与 class/style 定制外观。schema 或插件配置变化应使用新值，不要原地修改已经生效的对象。

## 组合式函数

在 setup 中调用 `useSmoothStream(() => input)` 或 `useDocumentSmoothStream(() => input)`。getter 读取最新字符串、布尔值及 ref.value，不接收冻结在初始化时的配置快照。

SmoothStreamInput 包含 content（必填）、streaming（默认 false）与 pacing（smooth / balanced / responsive，默认 balanced）。DocumentSmoothStreamInput 增加 documentId 和 coordinate；coordinate=false 退出协调。

返回 content 与 streaming 为只读 ComputedRef，flush 为函数；文档版本还返回 pending。模板可解包顶层 ref，渲染函数读取 .value。flush 在挂载前没有控制器可操作，生产端活跃时仍尊重字素保留，不取消请求。

控制器和观察器在挂载时创建、卸载时释放。初始与 SSR 内容完整显示；pacing 更新作用于已有控制器。文档身份或协调资格变化会释放旧订阅。

## 平滑组件

AIMarkdownSmoothStream 将组合式结果交给基础渲染器，额外属性为 pacing（默认 balanced）与 coordinate（默认 true），模板 ref 暴露 flush()。组件不发出呈现完成事件；需要监听排空时使用自定义组合式包装器。

## 插槽与上下文

| 插槽                     | 参数与行为                                       |
| ------------------------ | ------------------------------------------------ |
| strong、a 等 HTML 元素名 | MarkdownElementContext，优先于 components 同名项 |
| cursor                   | `{ streaming: true }`，定制测量外壳中的视觉内容  |
| waiting                  | 仅平滑组件，无参数；等待轮次时替代正文           |

MarkdownElementContext 包含渲染用 HAST node、清洗后的 properties、已转换的 children、streaming 与 metadata。映射组件接收元素属性及 node/streaming/metadata，children 在默认插槽中。元素插槽和 cursor 插槽不是同一参数类型。

AIMarkdownDocuments 没有配置属性，接受默认插槽并渲染 Fragment；孤立引用策略由各渲染器决定。

## 光标与生命周期

独立 AIMarkdownStreamingCursor 没有自定义属性，默认插槽提供指示内容，缺省为 ▍。它测量直接父元素，使用绝对定位和 aria-hidden 外壳；优先通过渲染器的 cursor 插槽定制，保持正确的测量根与尾部标记。

独立光标不会读取 streaming 属性，应用负责挂载条件。代码、数学、图片和没有本地目标的定义等尾部会隐藏光标；卸载释放观察器和动画帧，默认动画尊重减少动画偏好。

[快速开始](../guides/vue-quick-start.md) · [流式包装器](../guides/vue-streaming.md) · [SSR](../guides/vue-ssr.md) · [英文完整参考](english:docs/vue/)
