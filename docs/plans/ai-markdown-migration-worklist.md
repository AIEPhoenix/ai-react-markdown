# ai-markdown 实施与文档站准备矩阵（已确认）

本文件是 [包名、依赖与发布方案](./ai-markdown-packages-and-release.md) 的执行附件。所有“目标”都是讨论稿，未执行新包改名。当前发布工作区和自动迁移任务不受本文件影响。

## 1. 按代码位置拆分工作

| 位置                                               | 当前事实                                                        | 确认方案后要做的变更                                        | 验收                                                   |
| -------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| 根 `package.json`                                  | 私有根名 ai-react-markdown；2.14.x；脚本覆盖主包和原型          | 更名根项目并确定新主列车版本，保留私有属性                  | 根不会被 npm 发布；preflight 包含正式包与原型          |
| `packages/core`                                    | 当前是 React 实现                                               | 先移动到 `packages/react`，再处理 runtime 的目录迁入        | git 能追踪移动；旧 core 不被覆盖                       |
| `packages/runtime`                                 | 私有、0.0.0、被 React 内联                                      | 移到 `packages/core`，收口 API 后作为公开共享包             | 无 React/Vue/DOM 依赖；真实打包消费者能独立导入        |
| `packages/mantine`                                 | React/Mantine 集成                                              | 按最终名称移动到 `packages/react-mantine`                   | CSS、组件路径、peer 均正确                             |
| 所有主包 manifest                                  | repository/homepage/bugs 指向旧路径                             | 更新 repo 元数据和 directory，重建真实依赖与 peers          | npm tarball 的元数据、版本范围和仓库子目录一致         |
| `pnpm-workspace.yaml` / lockfile                   | packages、benchmarks、prototypes 都在 workspace；存在 fork 约束 | 更新目录匹配和新包依赖，保留既有 fork alias/override 语义   | 冻结安装成功；未无意升级第三方依赖                     |
| React `tsup.config.ts`                             | runtime alias/noExternal + dts resolve                          | 改为新 core/engine external，清除旧 runtime 内联规则        | 产物明确引用新包，保留 use client、两种模块格式和 CSS  |
| 共享 core `tsup.config.ts`                         | 当前服务私有 runtime                                            | 检查公开声明、external engine、dev/prod 条件                | 独立安装后 Node 可解析全部 exports                     |
| `assert-dist-clean.mjs`                            | 拒绝私有 runtime 导入，要求 engine 外置                         | 改成新包依赖和禁止旧 scope 泄漏的规则                       | 人为植入旧路径/框架内联可使守卫失败                    |
| runtime `assert-boundary.mjs`                      | 硬性要求 private=true                                           | 按新公共 core 的允许依赖、入口及类型环境重写                | 新包可发布但依然框架无关；不能简单删除守卫             |
| engine barrel / core barrel                        | 有星号导出、内部类型及测试 fixture                              | 逐项建立导出白名单；收窄公开函数签名                        | 声明快照不含未批准内部字段；跨包调用仍完整             |
| `scripts/version-packages.mjs`                     | 旧 core/engine/mantine 三包列车、README 正则绑定旧名            | 统一列车定义，区分独立插件/私有原型，更新 README 版本替换   | 缺包、错版本、错误 peer、独立包被误同步均可被检测      |
| `.github/workflows/release.yml`                    | 旧包名校验、旧 peer、插件先存在                                 | 更新列车和依赖前置校验，采用新身份 OIDC，保持 beta dist-tag | 小规模 beta 从 CI 发出并可真实安装；失败不生成成功记录 |
| `.github/workflows/ci.yml`                         | 所有包构建、递归测试、浏览器与 GC 回归                          | 确认新目录和私有原型继续被覆盖                              | 干净 checkout 与本地同样通过                           |
| `.github/workflows/benchmark.yml` / benchmark apps | 导入旧 React/Mantine 包和 styles                                | 只改名字/路径，保持对照输入与负载                           | 改名不改变比较场景；旧版可作为固定对照                 |
| issue/PR 模板、README、Storybook                   | 存在旧包名与仓库 URL                                            | 按语义修改；历史 release notes 保留历史名                   | 用户按当前模板报告新包；旧链接有正确归档路径           |
| Vue prototype                                      | 真实生命周期，但只有内存宿主和 SSR 准备                         | 保持实验状态，逐步加入 DOM 和正式适配层                     | 达到下面三条浏览器验收路径后再公开支持                 |

## 2. 独立消费者验收矩阵

这些检查使用 pack 产生的 tarball，安装进不属于 monorepo 的临时目录。源码 alias 或 workspace 上已经存在的 dist 不能替代发布消费验证。

| 场景                        | 核对内容                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| 只装 engine                 | 不解析 React/Vue/Mantine；公开声明和生产/开发入口均可加载                                    |
| 只装 core                   | engine 随 dependencies 正确安装；无私有包或旧 scope 引用；parse/plan/commit 生命周期符合契约 |
| 只装 React + peers          | core/engine 自动安装；标准渲染与旧版匹配；React 始终 external                                |
| React + Mantine + peers     | 组件、代码块、mermaid 懒加载、样式和 typography 子路径可用                                   |
| 单独引入 plugins 子路径     | 插件值能传入根组件，声明跨入口兼容；同一模块格式下重导出引用一致                             |
| 同一应用装 React 和未来 Vue | 各适配器依赖范围一致；独立 document scope 不互相污染；实际解析路径可记录                     |
| ESM 与 CJS                  | 两种消费方式分别通过；不宣称跨格式加载的对象引用必然相等                                     |
| dev 与 prod 条件            | 环境门控正确折叠，开发诊断可用，生产不读取缺失的 process                                     |
| SSR                         | Node 中不依赖 DOM；React 的服务器标记及 Vue 的服务器路径符合各自契约                         |
| 类型消费                    | 安装后分别编译 React、Mantine、高级 core 示例；检查 d.ts/d.cts、导出映射与 peer 范围         |
| 旧 → 新迁移示例             | 七类示例实际编译/运行；尤其验证旧 core 对应新 react，不能误导到新 core                       |

Node 和浏览器支持范围应显式列出实际验证组合。迁移初期沿用已验证的环境，不在 README 中把“manifest 写 >=20”自动等同于“所有 Node 20 小版本都跑过”。浏览器验证从现有 Chromium 扩展到实际承诺的宿主；WeakRef、SSR hydration 和框架调度都属于范围的一部分。

## 3. Vue 的三条浏览器验收路径

### V1：独立渲染和 hydration

一段包含普通文本、GFM、代码、HTML 和本地脚注的输入，先在服务器产生 HTML，再 hydration，随后逐步追加内容。验证初始结构一致、无 hydration 警告、URL 策略有效、追加和整体替换的输出正确。原型当前把 HAST 序列化输出，不能作为这条路径已完成的证据。

### V2：跨块引用和作用域切换

两个同文档 chunk，引用先到、定义后到；同时覆盖脚注、链接和图片。修改定义，移除定义所在 chunk，再切换 documentId；核对引用目标、脚注编号/回链、聚合 footer 归属和旧 registry 清理。加入另一个独立文档，确认二者互不污染。

### V3：组件扩展和流式交互

使用自定义代码组件/slot，切换 streaming 和完成状态，测试 smooth reveal、waiting slot、cursor 位置以及卸载。核对应用组件能接收明确的 Vue 数据/回调契约，不能依赖 React context 形状或 React 专属节点。

每条路径分别明确共享层负责什么、Vue 负责什么。只有真实重复且跨框架成立的逻辑才继续提取到共享层，不先把所有 DOM 代码搬进 core。

## 4. 文档站导航草案

```text
开始使用
  选择框架、安装、最小完整示例、环境支持
共享概念
  语法与预处理、流式输入与完成、跨块引用、URL 策略、性能模型
React
  组件与 hooks、上下文/metadata、自定义组件、排版、cursor/smooth
Vue
  支持状态、安装与 VNode/slot、响应式/生命周期、SSR hydration
集成
  React Mantine、独立 unified 插件、第三方集成指南
API
  Engine、共享 Core、React、Vue、React Mantine
迁移
  ai-react-markdown 2.14.x → ai-markdown、入口与 CSS 对照
开发
  架构、构建/分发、测试/soak、benchmark、发布
版本
  当前稳定、beta/实验、旧 2.14.x 归档
```

稳定页面只列实际已发布的框架；Vue 在完成验收前显示实验状态及明确限制。框架选择器切换的是相同主题下的示例和适配说明，不复制整份公共语法文档。

不在这一步决定站点生成器、域名或部署平台。先固定内容来源和示例集成要求，再评估工具是否能同时承载 React/Vue 示例及版本归档。README 仍保留完整安装和最小示例，不能只剩文档站链接。

## 5. 现有 docs 的页面归属

下表覆盖当前 `docs/` 根目录的 Markdown 文档；目标路径是信息架构草案，不是已经建立的 URL。

| 当前文档                     | 新站归属                          | 内容处理                                                    |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------- |
| README.md                    | 文档总导航                        | 改为按框架/任务定位；保留开发入口                           |
| architecture.md              | 开发 / 架构                       | 更新 engine/core/adapter 关系；React 渲染细节分节           |
| benchmark.md                 | 开发 / Benchmark                  | 保留历史测量及方法，框架对照标注版本                        |
| cjk-typography.md            | 共享概念 / CJK；框架排版示例      | 语法/排版原则共享，CSS 和组件示例按框架                     |
| content-preprocessors.md     | 共享概念 / 预处理                 | 共享工厂与算法契约，补各框架输入接线                        |
| cross-chunk-coordination.md  | 共享概念 / 跨块引用；框架生命周期 | registry 与解析模型共享；Provider/hook 属于 React           |
| custom-components.md         | React / 自定义组件                | ReactNode 和组件 props 保持 React 专属；Vue 单写 slot/VNode |
| custom-typography.md         | React / 排版扩展                  | 现有 React/Mantine 方法不能直接复制给 Vue                   |
| design-tokens.md             | 共享概念 / 主题；框架样式         | 区分可共享 token 与框架 Provider/样式接入                   |
| extending-via-subpackage.md  | 集成 / 编写第三方集成             | 更新包命名和 peer，分别说明框架接入                         |
| framework-transition.md      | 迁移 / 新组织与多框架             | 已实施事实与未来计划分开，移入最终确认的包映射              |
| metadata-context.md          | React / Metadata 与上下文         | 这是 React 扩展契约；Vue 需独立设计适配接口                 |
| migrating-to-v2.md           | 版本 / 旧版迁移归档               | 保留历史 API，不批量替换历史包名                            |
| release-highlights.md        | 版本 / 发布记录                   | 保留原始版本语义；按发布线导航                              |
| smooth-streaming.md          | 共享概念 / 平滑输出；框架使用     | 控制器原则共享，hooks/组件和生命周期分框架                  |
| soak-coverage.md             | 开发 / 正确性验证                 | 保留 oracle、参与度和 fresh release gate                    |
| streaming-and-performance.md | 共享概念 / 性能；React 缓存       | 算法成本与 React memo 成本分别说明                          |
| streaming-chat-example.md    | React / 完整流式对话示例          | SSE/UTF-8/取消概念可共享；组件与状态代码保留 React          |
| streaming-cursor.md          | React / Cursor；共享 DOM 原理候选 | 当前组件接口属于 React；Vue 通过验证后增加对应说明          |
| typescript-generics.md       | React / 扩展类型                  | 当前 Provider/hook 泛型契约不冒充全框架 API                 |
| url-sanitization.md          | 共享概念 / URL 策略               | 共享最终策略；各适配器引用/组件转换必须遵守                 |

```

各包 README 补充对应安装、exports、peer、最小示例和限制；engine/core 的高级 API 页面从批准的导出列表构建。README 和站点可以引用同一份示例源码，避免大段代码分叉。

## 6. 迁移时的检查记录

实施每段工作时，在 PR/提交说明中记录：基线提交、改变的包边、实际 tarball 版本、执行的测试、未覆盖的场景。保留 2.14.1 的发布记录作为旧库基线；当前规划分支不能替换它。

发布脚本和仓库转移已有独立后台状态文件。本方案等待确认期间，不推送规划分支、不改 main、不启动新 scope 发布，不改变已安排的 2.14.1 → 仓库转移顺序。
```
