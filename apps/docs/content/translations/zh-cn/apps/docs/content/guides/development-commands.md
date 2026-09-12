# 开发命令

在仓库根目录运行，使用 .nvmrc 与 package.json 固定的 Node/pnpm。安装依赖后按修改范围选择检查。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm format:check
pnpm typecheck
```

## 开发入口

| 命令                 | 作用                            |
| -------------------- | ------------------------------- |
| pnpm dev:docs        | 文档开发服务器                  |
| pnpm storybook       | 汇总目录和 React/Vue 两个子目录 |
| pnpm storybook:react | 单独 React 目录                 |
| pnpm storybook:vue   | 单独 Vue 目录                   |
| pnpm check:docs      | 文档类型与配置诊断              |
| pnpm build:docs      | 静态文档与 Pagefind             |
| pnpm test:docs       | 链接转换、生成内容和产物检查    |

## 验证入口

pnpm test:unit 运行包测试；pnpm test:core-contracts 验证共享契约；pnpm check:public-api 对比声明快照。pnpm packcheck 与 pnpm test:packed-consumers 检查公开打包产物，而不是仅检查 workspace 别名。

pnpm test:storybook 验证两个框架目录；pnpm test:vue-browser 与文档生命周期检查覆盖宿主行为。pnpm preflight 运行完整本地验收，但不执行长时间 soak，也不替代发布审核。

文档变更通常使用文档检查；引擎、协议和生命周期变更需要对应测试，不能用文档构建成功证明运行时正确。命令别名、先决构建与兼容测试见[英文命令表](english:docs/guides/development-commands/)。
