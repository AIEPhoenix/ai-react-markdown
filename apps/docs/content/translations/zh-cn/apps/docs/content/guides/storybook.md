# Storybook 开发

Storybook 是交互示例的运行环境。汇总目录连接 React 与 Vue，Mantine 位于 React 集成章节。Examples 是完整目录，Playground 是编辑自己的 Markdown 的入口。

## 启动

```bash
pnpm storybook
# 也可只启动一个框架
pnpm storybook:react
pnpm storybook:vue
```

汇总服务为 6006，React 为 6007，Vue 为 6008。开发模式直接解析 workspace 源码与样式，无需先构建包；静态构建使用公开包导出，并先构建依赖。

## 构建与验证

```bash
pnpm build:storybook
pnpm test:storybook
pnpm test:storybook:site
```

站点验证会打开实际 iframe、等待 Markdown 渲染，并验证汇总与独立入口。运行开发服务器测试时，它会临时修改并恢复源文件以验证热更新，因此应在空闲 checkout 中运行，避免同时编辑相关文件或运行其他浏览器测试。

## 发布与边界

Pages 把文档和完整 Storybook 一起部署，不能分别覆盖同一个站点。文档中文入口共享现有示例目录，Storybook 控件和样例名称当前保留英文。

无障碍 addon 的 todo 结果不是完整可访问性认证；共享核心契约、适配器生命周期和引擎 soak 是不同证据。完整目录维护规则见[英文指南](english:docs/guides/storybook/)。
