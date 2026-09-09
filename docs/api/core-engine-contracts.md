# Core / engine 公共 API 审查

本轮用完整 Vue 适配路径复核共享层边界，为稳定 3.0.0 建立明确契约。此文记录当前源码的审查决定，不把已发布 `3.0.0-beta.1` 的声明自动视为稳定承诺。Vue 首发与稳定版发布仍须完成独立发布验收。

## 层次和消费者

engine 提供语法、树转换、增量算法、引用 registry 和流式控制器。core 提供跨框架复用的 session、块规划、贡献准备/提交、聚合脚注和顺序协调。React 与 Vue 都显式依赖 core 和 engine；UI 集成依赖对应框架适配器。

core 不转发整份 engine API，也不接收 ReactNode、VNode、DOM 元素或框架生命周期。树到组件的转换、订阅与卸载时机、SSR hydration、slot/context 和光标测量由适配器负责。Vue 的实现与使用方式见 [Vue README](../../packages/vue/README.md)。

## 本轮 API 变更

| 项目                                                                       | 决定                                         | 原因                                               |
| -------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| engine 根入口 `export *`                                                   | 全部改为显式导出                             | 源模块新增 helper 不应自动扩大支持范围             |
| `PipelineSession` / `PipelineTrees`                                        | 新增命名类型，工厂明确返回 `PipelineSession` | 固定 parse/reset 接口，声明不随实现对象增长        |
| `ContributionSession`                                                      | 新增命名提交接口                             | 消费者只获得 commit 能力                           |
| `BlockPlanner`                                                             | 新增命名函数类型                             | 明确有状态工厂与每帧规划调用的区别                 |
| `isEnginePlugin`                                                           | 新增公开配置校验函数                         | React/Vue 可校验目录对象，无须读取内部 stage       |
| `getEnginePluginInternals` / `EnginePluginInternals` / `EnginePluginStage` | 从根入口移除，源码内部保留                   | stage 是管线实现细节；替代接口返回布尔判定         |
| `codePointSnapshots`                                                       | 从根入口移除；开发 stories 从源码导入        | 测试/演示分帧工具不属于生产适配契约                |
| `attributeHastChildren`                                                    | 从根入口移除，算法内部保留                   | HAST 归属由增量解析实现管理                        |
| `SENTINEL_FN_CONTENT` / `SENTINEL_LINK_URL`                                | 从根入口移除                                 | phantom 协议常量不应由适配器构造或匹配             |
| `preprocessAIMDContent` 额外预处理器数组                                   | 接受 readonly 数组                           | 实现只遍历输入，不应要求可变数组                   |
| 块 digest/fingerprint 辅助函数                                             | 保留高级 API                                 | React 的实际缓存使用；有效性仍依赖树和引用策略     |
| `computeFreezeBoundary` 与阶段计时                                         | 保留高级诊断入口                             | 有真实开发工具消费者；不承诺固定性能数值或日志字节 |

这些删除属于 beta 到下一版本的入口收口。已有 beta 高级消费者应改用支持入口，不能通过私有 dist 路径绕过。React 的组件、hooks、plugins 和 CSS 公共路径保持原有形状。插件对象内部的历史 brand 字符串继续保留，避免仅为组织改名改变已运行的配置语义。

## Core 工厂和生命周期

| 能力                                 | 输入与返回                                                  | 状态及释放                                                                            |
| ------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `createPipelineSession`              | `PipelineFrameOptions → PipelineTrees`；同步解析            | 单 chunk 单 session；reset 丢弃 retained state；宿主丢弃对象即释放，无计时器/全局注册 |
| `createBlockPlanner`                 | 完整 MDAST/HAST、预处理后的 source、phantom 提示 → 规划结果 | 单消费者保留前一帧；替换 planner 重置缓存；保留树不得原地修改                         |
| `derivePhantomTargets`               | 自身定义、registry labels、source → 缺失目标集合            | 纯准备；previous 仅是本消费者的快照身份提示                                           |
| `deriveCoordinationPolicy`           | 是否协调、是否注册、orphan 策略 → handlers/harvest 策略     | 不注册、不发布                                                                        |
| `buildContributionChain`             | 管线配置与前缀 → 身份元组                                   | 覆盖解析策略，不能只用 source 判断贡献是否失效                                        |
| `createContributionSession().commit` | 已提交树、labels、symbol、写能力、身份元组                  | 只能在宿主提交后调用；注册/release 由宿主负责                                         |
| `buildAggregateTree`                 | registry、前缀、orphan 策略 → footer HAST 或 null           | 只为最后一个有效 chunk 渲染；结果不允许写回共享 body                                  |
| `cloneHastForRender`                 | HAST 节点 → 结构克隆                                        | 克隆 node/children/properties/data 与 originalUrls；其他嵌套插件数据仍共享            |
| `createSmoothCoordinator`            | 可选 onEmpty → `SmoothCoordinator`                          | register/release 配对；微任务释放；done 在注册生命周期内 sticky                       |
| `deriveTailSignal`                   | MDAST、真实预处理内容长度 → 源尾部事实                      | 不读取 DOM；适配器决定测量和展示                                                      |

解析与准备结果按只读借用处理，即使底层 HAST 类型含可变数组。需要修改树或属性时先克隆。共享层没有深冻结每个节点，也不承诺所有对象返回新身份；适配器不能靠原地修改快照通信。

增量路径失败会清理 retained state，并尝试完整解析；如果完整管线本身失败，错误仍会同步抛出。fallback 不表示吞掉所有非法配置。`incrementalParse=false` 同时清空 retained state，适用于单次 SSR；服务端不需要浏览器检测来做这个决定。

块 key 负责匹配逻辑位置，不等于缓存始终有效。URL 策略、registry、组件和树身份变化仍可能要求重新转换。部分扫描/规划仍为 O(blocks) 或 O(document)，不承诺每次更新只与新增字符数成正比。

## Engine registry 的读写边界

`createRegistry()` 返回 `RegistryController`。读侧 `Registry` 暴露版本、只读索引快照、全局/按 label 订阅及解析选择器。写侧提供配对注册/释放和贡献方法；内部 refcount、订阅容器和通知函数不出现在公开返回类型中。

每次 `registerChunk(chunkId, ...)` 对应一次 `releaseSymbol(chunkId)`。同一 chunk 可在 deferred cleanup 前重新注册，但不能省略配对。`onEmpty` 在最终释放的微任务中执行；容器检查当前映射仍指向该 registry 后再删除，避免清理新实例。

通过 `registry.method()` 调用依赖接收者的方法；传递裸回调时使用闭包或绑定。卸载必须调用 unsubscribe。通知可合并净零变更，消费者读取当前快照，不按回调次数计算语义。聚合 body 变化不能仅依靠某个 URL selector 观察。

`ContributionRegistry` 刻意只有 `contributeChunkData`，共享贡献函数无权替宿主管理生命周期。AST、registry、协调器在 Vue 中保持浅引用，不能把 deep reactive 代理身份当作 engine 的原始节点身份。

## URL、占位符和扩展

适配器为每个 session 创建 provenance 值，同时传给 rehype 验证和跨块 handlers。来自 Markdown 的伪造 engine 标签不能被直接解释为框架内部组件。

常规 HAST 在框架转换前应用 `buildTransform` 的最终 URL 策略。跨块引用后来才得到目标，必须通过 `resolveCrossChunkReference` 补齐 sanitization、hash rebasing 和属性级 urlTransform；不能只给链接拼上 registry 原始 URL。`keepChildren` 区分 sanitizer 的解包与连子节点一起移除。

`sanitizeSchema` 是只读共享默认值；`extendSanitizeSchema` 创建独立草稿。新对象/函数身份通知适配器配置变化，原地改写已经使用的 schema 不属于支持方式。自定义框架组件仍是应用代码，其输出不由 Markdown sanitizer 再次审查。

## Smooth 控制器

engine controller 控制单个 source 的可见前缀；core coordinator 决定 chunk 何时获得展示机会。

- 首帧和 source 替换 snap；确认的 append 按 grapheme 揭示。
- finish 确认最后 grapheme 并排空积压；后续 update 可恢复流式输入。
- flush 仍遵循活跃流的 grapheme hold-back。
- controller options 对象是有意的 live 配置渠道；适配器更新 pacing 字段但保持对象身份。
- scheduler 必须异步且返回取消函数；同步调用 callback 违反契约。
- dispose 取消帧并清空订阅，但后续调用可重新激活；真正卸载后不得继续调用。
- coordinator done 是 sticky；要求多轮消息重新排队时，应建立新的注册身份。

## 声明和消费守卫

构建后运行 `pnpm check:public-api`。脚本比较去注释的完整声明与 [engine](./engine.api.txt)、[core](./core.api.txt)、[Vue](./vue.api.txt) 快照；拒绝私有 registry/coordinator 类型、本地 node_modules 路径和共享层框架依赖，检查根入口没有星号导出。签名变化需审查后才运行 `node scripts/check-public-api.mjs --update`。

快照检测不是语义证明。生命周期和不可变性由单元测试验证；Vue 的三条完整路径由真实浏览器验证；打包消费者在工作区之外安装 tarball，分别运行 ESM/CJS、dev/prod、SSR 和 TypeScript 消费。稳定发布还需当前候选的完整 release gate 和 fresh soak，旧 beta 的记录不能证明新候选已完成发布验收。

## 本轮验证记录

2026-09-09，工作区候选 3.0.0-beta.2：构建、lint/format、发布控制测试、attw/publint、递归与 Storybook 类型检查通过；完整 Vitest 为 154 个文件、1,990 个测试通过。React Chromium 生命周期/GC 与 Vue 三条浏览器验收路径通过。实际 tarball 在外部工作区完成 ESM/CJS、dev/prod、SSR、CSS、TypeScript 消费，并额外在 Vue 3.5.0 与匹配的 server-renderer 上验证 SSR 和类型兼容。常规工作区 Vue 版本为 3.5.42，执行 Node 为 24.20.0。

首轮检查修复了 CSS 检查配置、公开类型推导和测试 fixture 类型问题；最终相关检查均通过。release soak 尚未对本候选重新执行，npm Vue 首发和稳定版发布尚未进行。既有 beta.1 已完成 GitHub 预发布；维护者已明确接受四个 beta 包暂时保留 latest 标签。

## PR #56 复核（2026-09-09）

复核范围包括显式导出与声明快照、共享树所有权、Vue 注册/订阅/释放及微任务顺序、SSR 初始状态、引用与脚注转换、平滑流式协调、光标观察器，以及 Vue 首发凭据隔离。此次复核确认并修复一项 P2：协调路径的 `footnote-sup` 直接创建 VNode，跳过最终 URL 转换与 `a` / `sup` 自定义组件、slot。结果是同一脚注在普通 HAST 路径与协调路径使用不同的链接或元素配置。

修复先将脚注占位符物化为普通 HAST，再进入统一渲染转换。新增回归先复现 URL 回调未调用，再验证回调只执行一次且组件与 slot 均生效；Chromium 中的真实跨块脚注同时验证重写后的链接与自定义元素。对外声明没有变化。

复核后的全量单元检查通过 110 个文件、1,883 个测试，发布认证隔离测试通过。Vue 构建、类型检查、公共声明快照及 Chromium hydration/跨块引用/文档切换/流式/光标/卸载检查通过。上一节的 1,990 个测试是前一候选包含 Storybook 的完整结果，不能与本次单元测试计数直接比较。

此复核没有宣告稳定版兼容性。发布前仍需对最终候选执行新的 release soak；Vue 首发还应观察 npm 是否自动添加 latest，当前发布脚本会对此报错，beta.1 的人工接受记录不会自动放宽后续版本的检查。Nuxt、KeepAlive、Suspense 与更多浏览器仍属于未验证范围。
