# Mantine 代码块与图表

Mantine 在 React 基础适配器上提供代码高亮、复制、折叠、JSON 显示格式化与 Mermaid。先完成[Provider 和 CSS 设置](react-mantine-quick-start.md)。

## 代码语言与资源

已标注语言交给高亮适配器；autoDetectUnknownLanguage 默认 false，开启后可惰性加载 highlight.js 猜测未标注语言。提交给高亮器的字符串长度与调用频率会影响成本，不能把文本整理的线性复杂度当成高亮器耗时保证。

preloadMantineCodeAssets() 可提前启动 Mermaid 与自动检测资源导入。直接 eager import 只有在解析到同一模块实例时才复用同一加载结果。加载失败时渲染器保留回退。

## 源文本、显示与复制

JSON 格式化只改变显示，保留数值词法、重复键和键顺序。复制应使用原始代码源，而不是格式化或截断的显示文本。

highlightIntervalMs 默认 50，用于合并流式追加的显示更新；0 表示逐次显示。内容替换应及时反映，不能沿用旧内容的异步结果。异步高亮或图表任务完成时需要确认结果仍属于当前内容。

## 图表与定制

Mermaid 由集成层负责，基础 React/Vue 适配器不会自动执行图表。自定义 components.pre 会接管代码渲染，从而关闭该位置的 Mantine 代码功能。

选项默认值见 [Mantine 参考](../reference/react-mantine.md)。完整资源、复制和异步行为说明见[英文指南](english:docs/guides/mantine-code-blocks/)。
