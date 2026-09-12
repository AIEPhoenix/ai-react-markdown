# React 属性参考

从 `@ai-markdown/react` 导入默认 AIMarkdown 组件及 `AIMarkdownProps<TMetadata>` 类型。配置使用平铺属性；未传、undefined 和 null 的可选配置使用默认值。包装器共享属性命名空间，扩展前应检查现有名称。

## 内容与流式状态

| 属性            | 类型          | 默认值    | 说明                                                         |
| --------------- | ------------- | --------- | ------------------------------------------------------------ |
| content         | string        | 必填      | 完整累积 Markdown                                            |
| streaming       | boolean       | false     | 生产端是否仍在生成                                           |
| streamingCursor | ComponentType | undefined | 流式期间挂载的无参数组件插槽；可传 AIMarkdownStreamingCursor |

光标组件保持身份稳定，通常在模块作用域定义。内置光标只跟随能安全定位的文本尾部；不可见定义、其他片段中的脚注、代码与数学尾部可能使其隐藏。

## 外观与定制

| 属性                 | 类型                           | 默认值            | 说明                                   |
| -------------------- | ------------------------------ | ----------------- | -------------------------------------- |
| fontSize             | number 或 string               | 0.9375rem         | 数值按 px 处理                         |
| variant              | AIMarkdownVariant              | default           | 排版变体名称                           |
| colorScheme          | AIMarkdownColorScheme          | light             | light、dark 或扩展名称                 |
| metadata             | TMetadata                      | undefined         | 独立上下文中的应用数据；库不负责稳定它 |
| contentPreprocessors | AIMDContentPreprocessor[]      | undefined         | 在内置 LaTeX 预处理后顺序运行          |
| customComponents     | AIMarkdownCustomComponents     | undefined         | 替换 HTML 元素的 React 组件            |
| Typography           | AIMarkdownTypographyComponent  | DefaultTypography | 最外层排版组件，应合并注入的 style     |
| ExtraStyles          | AIMarkdownExtraStylesComponent | undefined         | 排版与正文之间的额外样式包装           |

`createRemendPreprocessor()` 提供可选的未完成尾部修复；它不会自动启用。能否移除未使用依赖取决于实际产物和应用打包器，不保证选择较少插件就减小 bundle。

## 文档与安全策略

| 属性           | 类型                              | 默认值               | 说明                                               |
| -------------- | --------------------------------- | -------------------- | -------------------------------------------------- |
| documentId     | string                            | useId 生成           | 同一逻辑文档的片段使用相同显式 ID                  |
| documentIndex  | number                            | 注册/挂载顺序        | 容器内片段的稳定文档顺序，适用于乱序挂载           |
| urlTransform   | UrlTransform 或 null              | defaultUrlTransform  | 最终 href、src 等 URL 策略                         |
| sanitizeSchema | SanitizeSchema                    | 库默认 schema        | 使用 extendSanitizeSchema 保留必要的数学与协调规则 |
| enginePlugins  | readonly AIMarkdownEnginePlugin[] | defaultEnginePlugins | 从封闭目录选择插件，数组替换整个集合               |

文档 ID 在生成 HTML 前缀时编码，长 ID 可能被缩短；hook 和 registry 的 ID 保持原值。不要自行推导生成前缀的稳定字节格式。documentIndex 不会重排平滑输出的挂载队列。

默认最终 URL 策略允许 http、https、irc、ircs、mailto、xmpp 以及相对引用。自定义协议还需要清洗 schema 放行，详见 [URL 策略](../url-sanitization.md)。

## 行为开关

| 属性                     | 默认值 | 作用                                             |
| ------------------------ | ------ | ------------------------------------------------ |
| blockMemo                | true   | React 块复用，也是跨片段协调与增量解析使用的路径 |
| incrementalParse         | true   | 复用确认的解析前缀；仅 blockMemo 开启时有效      |
| preserveOrphanReferences | true   | 保护未完成文档中的孤立脚注/链接定义，影响输出    |

AIMarkdownDocuments 的孤立引用策略无条件覆盖内部片段同名属性。服务器完整解析。关闭 blockMemo 不是通用性能修复，协调文档的引用可能因此保留字面形式。

查看[组件参考](../../reference/react.md)、[Hooks](react-hooks.md)与[英文逐属性说明](english:docs/guides/api/react-props/)。
