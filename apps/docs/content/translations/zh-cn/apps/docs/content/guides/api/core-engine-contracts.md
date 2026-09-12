# Core / Engine 公共契约

Engine 提供语法、树转换、增量算法、registry 与流式控制器。Core 提供会话、块规划、贡献发布、脚注汇总和轮流协调。应用通常使用框架适配器，适配器作者保持共享包版本一致。

## Core 工厂与状态

| API                                | 生命周期                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| createPipelineSession              | 每个独立片段一个会话；parse 同步，reset 丢弃保留状态                     |
| createBlockPlanner                 | 保留一个消费者的前帧，重新创建可重置；不要修改借用树                     |
| derivePhantomTargets               | 纯准备计算，previous 只是快照身份提示                                    |
| deriveCoordinationPolicy           | 推导处理/采集策略，不注册也不发布                                        |
| buildContributionChain             | 建立解析策略身份，不能只用源文本相等判断贡献有效                         |
| createContributionSession().commit | 仅在宿主 commit 后发布，宿主负责注册与释放                               |
| buildAggregateTree                 | 生成末尾合格片段的脚注树，不改写共享正文                                 |
| cloneHastForRender                 | 克隆结构、属性与 data 等，但任意嵌套插件数据可能仍共享                   |
| createSmoothCoordinator            | register/release 配对，空状态清理延迟到微任务，done 在注册生命周期内保持 |
| deriveTailSignal                   | 从 MDAST 与真实预处理长度推导尾部，不读取 DOM                            |

## 错误与所有权

把会话树当作借用只读值；渲染时需要修改则先克隆。独立片段和并发消费者不能共享一个可变 session 或 planner。

增量路径失败会清空状态并尝试完整解析。仅 EngineRawHtmlDepthError 触发转义纯文本段落降级，下一帧再次正常解析。其他完整流水线异常，包括应用插件或处理器抛错、普通 RangeError，继续传播。

## Registry 与 URL

createRegistry 返回带读写边界的控制器，公共 Registry 是只读查询与订阅接口。registerChunk 和 releaseSymbol 必须配对，订阅必须退订。方法可能依赖接收者，应通过 registry.method() 调用。微任务清理应确认容器仍指向同一实例。

普通 HAST 在转换成框架元素前执行最终 URL 策略；跨片段 URL 稍后才出现，必须经 resolveCrossChunkReference 完成清洗、hash 重定向和逐属性转换。不能直接把 registry 原始目的地址写进 DOM。

每个协调实例使用一致且独立的 provenance，验证引擎占位符，不能把 Markdown 伪造标签直接解释为内部组件。

## 控制器

初始和替换直接显示，确认追加按字素推进，finish 结束保留并排空。flush 尊重活跃字素保留。options 是实时配置对象，但调度必须异步且提供取消函数。

dispose 取消调度和订阅，但后续调用可再次激活控制器；实际卸载后不要继续调用。协调器的完成状态是粘性的，新消息需要新的注册身份。

[适配器教程](../building-an-adapter.md) · [英文完整契约与声明链接](english:docs/guides/api/core-engine-contracts/)
