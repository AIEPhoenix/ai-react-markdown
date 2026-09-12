# 发布流程

使用新的版本与标签发布。已经发布的 npm 版本和 Git 标签不可覆写；修复使用新补丁或候选版本。原始 3.0 接受记录中的特殊审核例外不适用于未来发布。

## 准备版本

```bash
pnpm version-packages "${NEXT_VERSION:?Set NEXT_VERSION to the intended release version}"
pnpm install
```

审阅完整变更、peer 范围和当前文档。发布记录写入英文 release-highlights.md 的 `### <version>` 章节，工作流提取到下一个三级标题为止；中文记录是阅读入口，不改变发布正文提取来源。

## 验收顺序

1. 最终源代码运行 pnpm preflight，检查构建、类型、测试、打包消费者与浏览器等。
2. 等待远端 CI，包括 Node 安装矩阵和共享契约通过。
3. 提交干净候选，检查 soak 影响；需要时完成六路径证据及审核。
4. 为验证的版本打标签，通过发布工作流与必要的人工审批。
5. 已有包使用 trusted publishing；稳定版用 latest，候选版使用相应 beta/rc 标签，独立插件保持自己的版本。
6. 要求发布后 registry 与消费者验证，保留实际报告，再创建 GitHub Release。

## 发布后验证

```bash
pnpm test:published-release "${RELEASE_TAG:?Set RELEASE_TAG to an existing release tag}" .local-notes/published-release
```

目标必须是存在的标签，预期 npm channel 仍指向该版本。检查会下载实际 tarball，在 workspace 外验证模块、CSS、声明、SSR、元数据、完整性和来源一致性。旧 channel 被新版本推进后，旧标签的 channel 校验会有意失败。

来源内容一致性检查不等于 Sigstore 密码学签名验证。已复用插件产物保留原始来源调用；允许的 README-only 漂移范围与实现变更规则以发布脚本为准。

候选晋升、恢复失败上传与 provenance 细则见[英文当前流程](english:docs/guides/releasing/)。
