# 开发 React 集成

本页面向 React 设计系统包装器，不是开发新框架适配器。通用宿主请阅读[开发框架适配器](building-an-adapter.md)。

## 保持包边界

把 @ai-markdown/react 声明为兼容 peer，避免集成包携带另一份 React 适配器上下文。发布前验证受支持的 peer 范围；预发布集成应与候选版本精确匹配。

## 包装组件

继承 AIMarkdownProps 并保留元数据泛型。提供自己的 Typography、ExtraStyles 或 customComponents 默认值，调用方在公开插槽上覆盖它们。Typography 合并注入 style 与 className，保持字号根变量。

仅添加真正属于集成的新属性，并检查基础属性及其他包装器的命名空间。Mantine 的 codeBlock 是行为组扩展示例。

## Provider 与窄 Hook

组按键合并，内层同名组整体替换外层组。未提供配置时不要贡献空组去遮蔽应用级默认值；读取 Hook 再按自己的默认配置补齐缺失字段。

用声明合并公开组类型，把断言集中在窄 Hook 边界。自定义工厂只提供类型与冻结，不应隐式添加复杂运行行为。

## 验证

在 workspace 之外安装打包产物，检查 React peer、ESM/CJS、声明、CSS、SSR 以及框架上下文身份。不要只依赖源码别名下的开发成功。

完整集成包模板与发布配置见[英文教程](english:docs/guides/extending-via-subpackage/)。
