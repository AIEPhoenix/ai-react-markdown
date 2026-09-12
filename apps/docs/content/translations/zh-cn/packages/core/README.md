# @ai-markdown/core

不依赖 React 或 Vue 的共享编排层，与框架适配器使用同一发布版本。应用通常只安装适配器；适配器作者可直接安装匹配版本的 core 和 engine。

## 主要职责

Core 提供解析会话、块规划、虚拟定义目标、协调策略、贡献发布、聚合脚注树、渲染克隆、尾部信号与平滑队列。它不负责 DOM、ReactNode、VNode、框架 effects 或样式。

## 会话与借用结果

createPipelineSession().parse 接收完整源与解析配置，同步返回 MDAST/HAST。每个独立片段持有自己的可变会话；reset 清理保留状态。服务端可以关闭 incrementalParse，直接完整解析。

借用树不得原地修改；渲染策略需要变换时用 cloneHastForRender。结构克隆不保证任意插件嵌套数据完全隔离。块 key 相同也不单独保证缓存有效。

## 发布与释放

准备解析和规划时不发布共享状态。宿主 commit/mount 后注册并提交贡献，卸载配对释放和退订。跨请求共享可变会话或 registry 会污染文档状态，应避免。

增量失败先重试完整解析；仅特定 EngineRawHtmlDepthError 降级为转义文本，其他完整流水线异常传播。下一帧重新尝试正常解析。

完整生命周期表见 [Core / Engine 契约](../../apps/docs/content/guides/api/core-engine-contracts.md)，可执行 HAST host 见[开发适配器](../../apps/docs/content/guides/building-an-adapter.md)。[英文包参考](english:docs/core/)保留全部接口说明与示例。
