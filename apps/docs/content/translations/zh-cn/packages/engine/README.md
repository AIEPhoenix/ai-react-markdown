# @ai-markdown/engine

框架无关的 Markdown 解析引擎，提供 unified 流水线、LaTeX 预处理、增量解析、定义与脚注 registry、树算法和字素级平滑控制器。应用通常通过 React/Vue 适配器使用它。

## 流水线与插件

buildCoreRemarkPlugins、buildCoreRehypePlugins 与 buildCoreRemarkRehypeOptions 组装共享处理链。createProcessor 与分阶段解析/转换用于高级宿主。封闭插件目录包含 highlight、definitionList、removeComments、smartypants 和 pangu。

增量解析复用确认的前缀，未完成尾部和部分全量扫描仍有成本。使用状态会话时，配置、树与输入身份都参与有效性判断，不保证每次更新成本仅与新增内容成正比。

## 原始 HTML 与 URL

原始 HTML 路径在后续递归处理前检查嵌套深度，内部上限为 256。超过边界或该步骤自身的受识别栈溢出报告 EngineRawHtmlDepthError；共享会话只对该错误执行文本降级。普通插件异常不会被吞掉。

清洗 schema 与最终 URL 转换分属不同阶段。协调目的地址通过 resolveCrossChunkReference，不能绕过其安全与前缀处理。默认 schema 为共享只读值，修改策略时使用 extendSanitizeSchema 的独立草稿。

## 状态与框架边界

registry 注册和释放需要配对，订阅需要清理。不要修改只读快照。控制器的 update、finish、snap、flush、subscribe、getVisible、isDrained 与 dispose 由宿主生命周期驱动；schedule 必须异步。

Engine 不持有框架 UI。要构建新适配器，先阅读 [Core / Engine 契约](../../apps/docs/content/guides/api/core-engine-contracts.md)与[开发适配器](../../apps/docs/content/guides/building-an-adapter.md)。全部底层导出、输入与算法说明见[英文引擎参考](english:docs/engine/)。
