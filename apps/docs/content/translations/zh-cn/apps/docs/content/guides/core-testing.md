# Core 与适配器测试

共享解析正确不等于框架生命周期正确。为不同层选择相应验证，避免把一个绿色测试扩展成整个系统的保证。

## 共享契约

Core 测试覆盖会话重置、借用树、增量与完整结果、贡献与聚合、协调注册/释放及不可变边界。Engine 验证语法、定义扫描、增量 splice 和降级策略。

```bash
pnpm build
pnpm test:core-contracts
pnpm check:public-api
```

声明快照检查名字与签名，不证明默认值、异步调度或生命周期语义。

## 框架与消费者

React/Vue 需要测试提交或挂载、替换、晚到定义、身份切换、卸载以及 SSR/水合。光标几何与 DOM 更新要在真实浏览器验证。Vue 对象不要深代理引擎 AST/registry 来替代其原始身份。

打包消费者在 workspace 之外安装产物，验证 ESM/CJS、CSS、类型和公开入口。只在源码别名下成功不足以证明 npm 安装可用。

## Soak 的作用

Soak 扩大引擎输入与配置覆盖，不能替代宿主生命周期测试。反过来，框架浏览器测试也不证明所有增量语法输入等价。详细命令及案例类别见[英文测试指南](english:docs/guides/core-testing/)。
