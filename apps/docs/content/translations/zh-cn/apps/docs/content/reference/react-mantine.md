# Mantine API 参考

Mantine 是 React 集成。安装 @ai-markdown/react-mantine、兼容的 React 适配器以及 Mantine 9、highlight.js 等 peers，并保留 Provider 与 CSS 顺序，见[快速开始](../guides/react-mantine-quick-start.md)。具体 peer 范围以包 manifest 为准。

## 继承与覆盖

MantineAIMarkdownProps<TMetadata> 继承 [React 基础属性](../guides/api/react-props.md)。仅以下五项由集成新增或改变默认行为：

| 属性             | 行为                                               |
| ---------------- | -------------------------------------------------- |
| colorScheme      | 未传时使用 Mantine useComputedColorScheme('light') |
| customComponents | 合并 Mantine 内置 pre 处理器；调用方同名项优先     |
| Typography       | 默认为 MantineAIMarkdownTypography                 |
| ExtraStyles      | 默认为 MantineAIMDefaultExtraStyles                |
| codeBlock        | Partial<MantineCodeBlockOptions> 行为组            |

覆盖 pre 会接管代码渲染，并关闭该位置的 Mantine 高亮、格式化和图表处理。

## codeBlock 配置

| 字段                      | 默认值 | 用途                                         |
| ------------------------- | ------ | -------------------------------------------- |
| defaultExpanded           | true   | 长代码块初始展开                             |
| autoDetectUnknownLanguage | false  | 用 highlight.js 猜测未标注代码语言           |
| formatJson                | true   | 格式化 JSON 显示，保留数值词法、重复键和顺序 |
| expandNestedJson          | true   | 格式化时展开包含 JSON 对象/数组的字符串      |
| highlightIntervalMs       | 50     | 合并流式追加期间的显示更新，0 表示每次更新   |

间隔必须有限且非负，否则回退到 50 ms。组边界 null 等同缺省，不代表每个字段也支持 null。显式 undefined 字段使用包默认值。

缺省或 null 的 codeBlock 不贡献该组，因此外层 AIMarkdownBehaviorsProvider 仍可提供它。显式组整体覆盖外层同名组，不是字段级合并；useMantineCodeBlockOptions 再补齐缺省字段。

## Hooks 与导出

- useMantineCodeBlockOptions()：返回解析并填充默认值后的代码块选项。
- useMantineAIMarkdownMetadata<T>()：读取具有 Mantine 扩展类型的元数据。
- defineMantineBehaviors()：创建冻结的行为属性片段，包含 React 行为字段及 codeBlock。
- defaultMantineCodeBlockOptions：冻结的默认选项。
- preloadMantineCodeAssets()：提前启动 Mermaid 与自动检测资源的惰性导入，可重复调用；渲染器保留失败回退。

主题排版组件与额外样式组件从根入口导出。默认主组件已 memo；它的生命周期与 React 基础组件相同。Vue 不能直接使用该集成。

[代码与图表](../guides/mantine-code-blocks.md) · [React 平滑输出](../guides/smooth-streaming.md) · [英文完整参考](english:docs/react/mantine/)
