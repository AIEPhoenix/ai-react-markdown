# Core 契约与状态序列验证

`@ai-markdown/core` 是独立的框架无关包，测试应随实现归属维护。Engine 六腿 soak 验证解析算法，不能替代 core 的状态、缓存、提交和清理检查。本门禁也不证明 React/Vue 的 DOM、hydration 或宿主生命周期正确；它们仍需要适配器测试。

## 执行入口

在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm test:core-contracts
```

该入口依次构建 core 及其工作区依赖、检查 core 类型、运行 core 的全部测试。它不依赖预先构建的 React/Vue，不加载根目录 Storybook 项目。测试同时检查实际 ESM/CJS 的 development/production 入口能在无 UI 框架、无浏览器环境下工作。

门禁已接入根目录 `preflight`、CI 独立的 `core-contracts` 项，以及 Release 工作流。任一步非零退出即失败。CI 的全仓测试继续保留，用于发现迁移测试后适配器集成回归。

## 覆盖归属

| Core 模块                           | Core 内的主要测试                                     | 验证重点                                                                         |
| ----------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pipelineSession`                   | `runtime.test.ts`、`stateSequences.test.ts`           | 增量与完整解析一致、追加/替换、配置和文档切换、reset、单次解析、异常后恢复       |
| `blockPlan` / `blockPlanner`        | `blockPlan.test.ts`、`blockPlanner.test.ts`、状态序列 | 块与引用上下文、指纹、六种插件配置、保留前缀复用、phantom 策略变化及完整规划对照 |
| `coordinationPreparation`           | `coordinationPreparation.test.ts`                     | phantom 集合、handlers/harvest 策略、影响正文的贡献身份元组                      |
| `contribution`                      | `runtime.test.ts`、状态序列                           | 显式提交、重复提交去重、定义更新/删除、registry 与注册身份切换、策略失效         |
| `aggregateFootnotes`                | `aggregateFootnotes.test.ts`、runtime、状态序列       | 顺序、重复引用回链、orphan 开关、卸载后的聚合、输出所有权与前缀隔离              |
| `cloneHastForRender`                | `cloneHastForRender.test.ts`                          | 冻结输入、URL 元数据隔离、有意共享的嵌套数据边界                                 |
| `tailSignal`                        | `tailSignal.test.ts`                                  | MDAST 尾部分类、嵌套下降和 phantom 排除                                          |
| `coordinator` / `smoothCoordinator` | `smoothCoordinator.test.ts`、状态序列                 | 排队、sticky done、引用计数、微任务释放、通知合并、心跳和清空                    |
| 公共产物边界                        | `runtime.test.ts`、构建检查                           | 真实入口无框架依赖、无 DOM，公开声明不泄漏内部容器                               |

纯 planner、coordinator、尾部推导以及 blockMemo 中的纯块规划/指纹测试从 React 迁入 core。React 的渲染缓存、组件输出、聚合脚注组件和尾部 DOM marker 测试仍留在 React，继续验证适配器集成；不能为了目录整齐把 ReactNode 缓存测试挪入 core。

## 固定种子的状态组合

`stateSequences.test.ts` 默认使用 `20260909`、`20260910`、`20260911` 三个固定种子。每个种子驱动三类性质，每类生成 24 条序列，每条包含 24–48 个随机操作；关键操作另有固定前缀，避免某条序列完全跳过主要状态轴。

1. **Pipeline / planner**：交错追加、替换、配置/文档切换、reset 和单次解析。每帧与独立 engine 完整解析比较，再将保留状态的 planner 与完整 `buildBlocks` 比较。
2. **贡献 / 聚合**：三个 chunk 在两个 registry 间更新、删除定义、切换文档、停用/重新注册、替换管线配置。持续提交的结果与每步新建 registry、完整解析和新 publisher 的重建结果比较；另检查重复提交不增加版本、释放后 registry 和标签清空。
3. **顺序协调**：与仅维护顺序、计数及 done 集合的模型对照。逐步验证前驱阻塞、重复注册、完成、释放和微任务内复活；最终验证状态清空及取消订阅后不再收到通知。

重建对照重点捕获跨帧遗留和失效错误；同一个纯聚合算法若同时出错，对照本身未必能发现，因此编号、回链和所有权还保留独立的明确断言。这不是穷尽所有 Markdown 或所有状态序列，也不是长时间内存压力测试。

## 失败复现与扩充

fast-check 失败会输出种子、缩减路径和缩减后的操作序列。先构建产物，再使用测试输出中的值复现；路径只应用于对应性质：

```bash
CORE_SEQUENCE_SEED=20260909 CORE_SEQUENCE_RUNS=24 CORE_SEQUENCE_PATH='替换为失败输出的 path' \
  pnpm --filter @ai-markdown/core exec vitest run src/stateSequences.test.ts \
  -t 'contribution/aggregate'
```

删除 `CORE_SEQUENCE_PATH` 可重跑完整种子。提高 `CORE_SEQUENCE_RUNS` 可执行本地扩展检查。正式门禁清除这三个环境变量，始终使用提交到源码的默认预算，避免开发者的复现配置意外缩小 CI 覆盖。

新增公共状态或缓存依赖时，补充对应的状态操作和明确断言；新模块应更新本表。这里不设虚假的覆盖率百分比：当前证据是行为契约与断言，尚未生成行/分支覆盖率报告。
