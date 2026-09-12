# React Hooks 与 Provider

上下文 Hooks 从周围的 React 渲染器读取状态。平滑 Hooks 见[平滑输出](../smooth-streaming.md)，registry 读取见[文档协调](../cross-chunk-coordination.md)。稳定性辅助 Hooks 也可用于其他 React 组件。

## 五个窄订阅 Hooks

| Hook                       | 返回内容                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| useAIMarkdownDocument()    | documentId、documentIdExplicit、clobberPrefix                      |
| useAIMarkdownTheme()       | fontSize、variant、colorScheme                                     |
| useAIMarkdownState()       | streaming 与扩展状态组                                             |
| useAIMarkdownBehaviors()   | blockMemo、incrementalParse、preserveOrphanReferences 与扩展行为组 |
| useAIMarkdownMetadata<T>() | T 或 undefined                                                     |

窄 Hook 不因其他上下文更新而收到通知，但正常的父组件 render 仍可能导致重渲染。除元数据 Hook 外，在对应 Provider 边界之外调用会抛错；未提供元数据时返回 undefined。

`useAIMarkdown<T>()` 聚合以上内容，方便需要完整状态的组件，但订阅范围更广。clobberPrefix 应从文档 Hook 读取，不要在自定义锚点中自行重算。

## 附加 Provider

AIMarkdownStateProvider 与 AIMarkdownBehaviorsProvider 通过 value 传入扩展组，并接受 children。内层同名组覆盖外层整个组，不进行字段级深合并。使用者的窄 Hook 再为缺少的字段提供自己的默认值。

组名属于共享命名空间，扩展库应使用独特键并声明类型扩展，避免覆盖其他集成。Mantine 的 codeBlock 就是一个行为组。

## 稳定性辅助

`useStableValue<T>(value)` 根据深比较复用上一次已提交的等价值。放弃的 render 不推进已提交缓存；不能通过原地修改同一对象通知变化。

`useStableRecord(record, table)` 按表中每个键的策略处理，未列出的键不会出现在返回结果中。策略包括深比较复用、仅开发告警和直接透传。它不是自动 memo 所有内容的工具，metadata 仍由调用方负责稳定。

`defineTheme`、`defineBehaviors`、`definePipeline` 创建冻结且具类型的平铺属性片段；在模块作用域复用，避免每次 render 重新创建。

可执行组合与类型扩展范例见[英文完整参考](english:docs/guides/api/react-hooks/)。
