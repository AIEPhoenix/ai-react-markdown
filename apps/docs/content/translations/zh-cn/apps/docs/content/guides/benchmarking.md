# 基准测试方法

先明确要回答的问题：解析是否更快、React 提交是否减少、代码高亮是否占主导，还是浏览器布局阻塞。不同工具不能互相代替。

## 选择工具

| 工具            | 适用范围                                             |
| --------------- | ---------------------------------------------------- |
| pnpm bench:unit | 孤立的 LaTeX 预处理微基准                            |
| Storybook 对照  | 解析阶段与 React commit 归因，开发模式不代表生产延迟 |
| pnpm bench:web  | 生产浏览器集成、帧间隔、长任务与 DOM/视口行为        |

现有生产浏览器应用覆盖 React、Mantine 和 React 文本对照，不构成 Vue 性能证据。

```bash
pnpm build
pnpm bench:web:selftest
pnpm bench:web --app react-core --scenario code-dense --repeats 5
```

selftest 检查测量工具是否对注入工作敏感，不是库速度阈值。结果位于忽略的 benchmarks/results。

## 报告方法

前后使用同一负载、插件、初始状态和投递节奏。保留正确性比较，不要通过删掉有意义的链接或脚注差异来制造相等。

记录版本、浏览器、设备、构建模式、重复次数与波动，区分冷启动和稳定流式过程。标明超时。解析有较大相对收益时，端到端提升仍可能很小，因为高亮或布局占主导。

[历史测量](benchmark.md)不是当前性能承诺。更多 harness 参数见[英文指南](english:docs/guides/benchmarking/)。
