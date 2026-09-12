# 文档站维护

独立站位于 apps/docs，使用 Astro Starlight。英语保持无前缀路由，简体中文使用 /zh-cn/。首页位于语言根目录，文档位于 docs，examples 嵌入同一份 Storybook。

## 本地开发

```bash
pnpm dev:docs
pnpm check:docs
pnpm build:docs
pnpm test:docs
pnpm preview:docs
```

搜索在生产构建时生成，不能只通过开发服务器验证。

## 唯一内容来源

英文 guides 与 reference 文件是维护基线。中文源文件位于 `apps/docs/content/translations/zh-cn/`，在其下镜像原始仓库路径。每页保留一级标题，正文使用源文件相对链接。不要直接编辑生成且忽略的 src/content/docs。

中文文档按照中文阅读路径组织；历史档案页提供版本导读并链接英文完整记录，不改写原始发布证据。维护 API 时同步两种语言的默认值、生命周期与示例。

content.mjs 生成路由与编辑链接，并保留旧 README 的来源别名。新增页面除了加入内容生成清单，还要确认侧栏和中文内容覆盖。样式、布局和首页组件由两种语言共享。

## 链接与语言

中文正文中的相对文档链接优先进入中文对应页。examples: 指向当前语言的示例工作区；storybook: 指向共享示例目录；english: 可显式跳转到英文详细参考。代码块内容不参与链接重写。

语言配置在 src/i18n/config.mjs，自定义导航翻译在 src/content/i18n；Starlight 提供搜索、主题和标准界面的中文。修改标题时检查相关锚点，不要假定中英文标题生成相同 ID。

## 版本与发布

当前版本以 manifest 为准。版本脚本更新英文的当前版本说明与允许更新的安装片段，历史文档不做全局替换。中文使用 manifest/发布记录链接避免重复硬编码当前版本。新增有固定版本的中文示例时，应同步扩展发布检查。

GitHub Pages 把官网、文档与 Storybook 合成一个产物。根域名仓库和项目镜像分别部署，必须核对两边 source-commit.txt 及修改后的页面。

```bash
DOCS_SITE_URL=https://ai-markdown.github.io DOCS_BASE=/ai-markdown/ pnpm build:docs
DOCS_BASE=/ai-markdown/ pnpm test:docs
```

完整组合构建与双部署命令见[英文维护参考](english:docs/guides/documentation-site/)。
