# 发布历史

按对应版本解读记录。旧配置名称、依赖、默认值、测试数量和性能结果是当时的事实，不能当作当前接口说明。完整逐版本正文与证据保留在[英文发布历史](english:docs/guides/release-highlights/)。

## 3.0.1：渲染与流式正确性

五个主包同步到 3.0.1，独立高亮插件保持 1.0.2。该补丁修复流式数学、脚注协调、React 延迟水合及 Vue 失效更新，同时保留既有公开入口。

深层原始 HTML 在守卫步骤报告特定深度错误，共享会话将该帧降级为转义文本；任意插件异常不属于此兜底。验证记录只证明对应输入和配置，不是所有应用组合都被覆盖。

## 3.0：多框架公共基础

Core 与 Engine 成为显式公开共享包，React 与 Vue 适配器拥有独立的应用 API。旧 @ai-react-markdown/core 是 React 渲染器，不能机械映射到新的无 UI Core 包。

## 2.x 与更早版本

2.0 从对象 config 改为平铺属性、封闭引擎插件目录与窄 Hooks。后续 2.x 包含解析、协调、样式和生命周期修复，不能由最初兼容声明推断所有版本逐字节 HTML 相同。

升级时先读[包迁移](framework-transition.md)和 [1.x → 2.x 迁移](migrating-to-v2.md)，再在英文原记录中查看跨越的具体版本。当前使用方式见 [React](../reference/react.md)、[Vue](../reference/vue.md)与 [Mantine](../reference/react-mantine.md)。
