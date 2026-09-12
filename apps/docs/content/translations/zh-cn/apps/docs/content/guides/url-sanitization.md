# URL 与原始 HTML

Markdown 输出经过 HTML 清洗与最终 URL 转换。自定义协议必须同时满足两道策略，不能只修改 urlTransform。

## 两道检查

清洗 schema 可能先从 href/src 移除不允许的协议；urlTransform 之后再处理仍然存在的 URL。默认最终策略允许 http、https、irc、ircs、mailto、xmpp 与相对 URL，不默认允许 javascript、data 或应用私有协议。

## 扩展 schema

使用 extendSanitizeSchema 获得独立草稿并修改允许的协议，保留库为数学和跨片段占位符增加的规则。不要从上游 defaultSchema 随意浅拷贝，也不要原地修改已经生效的 schema。

扩展 URL 策略时使用稳定函数，严格解析并允许需要的协议；scheme 名包含正则特殊字符时正确转义。不要用模糊前缀匹配代替协议验证。

## 跨片段目的地址

registry 中的原始定义不等于可直接写入 DOM 的安全地址。框架内部通过 resolveCrossChunkReference 清洗、重写 hash 前缀并执行逐属性 URL 转换。自定义链接组件同样需要策略。

## HTML 与应用边界

原始 HTML 解析还有深度保护，但这不是所有异常的兜底。自定义 React/Vue 组件是应用代码，其输出不会再次被 Markdown 清洗器检查。扩展策略应配合完整应用输入测试。

具体 schema 示例与 URL 回调签名见[英文完整指南](english:docs/guides/url-sanitization/)。
