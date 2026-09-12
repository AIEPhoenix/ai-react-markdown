# Soak 覆盖与发布证据

Soak 是引擎变更的长时间输入与配置验证，独立于文档构建、框架浏览器测试和普通 CI。发布前先评估修改影响，再按现行策略决定是否需要新活动或可以复用证据。

## 检查入口

```bash
pnpm check:soak-coverage
pnpm check:soak-impact
pnpm check:release-soak --evidence .soak-logs/<run-id>
```

上面的 run-id 是实际活动目录的占位符。证据必须与最终已提交的候选状态和策略匹配，不能把旧日志改名冒充新活动。

## 覆盖与执行

当前发布 profile 有六条验证路径、84 个逻辑任务，包括随机 splice、方向测试、定义标签扫描、有界穷举、conformance 与 LaTeX 预处理入口等价性。逻辑分片数量与机器执行并发不同；降低 worker 数不应改变应完成的逻辑任务。

运行活动使用新的 seed base，观察心跳、百分比、失败样例与超时。必须记录实际完成状态，静默或观察窗口结束不等于活动成功。

## 发布约束

引擎受影响时遵循证据校验和人工 soak-approval 审核。纯文档修改通常不需要重跑引擎 soak，但仍以影响检查为准。通过活动只证明其输入家族与配置范围，不意味着所有宿主或所有语法都被穷尽。

完整路径映射、预算、复用和审批规则见[英文覆盖文档](english:docs/guides/soak-coverage/)。
