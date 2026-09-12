# ==高亮== remark 插件

`@ai-markdown/remark-mark-highlight` 为 unified / remark 流水线提供 `==高亮文字==` 语法，生成 mark 节点及对应 HTML。它按独立 semver 发布，不与主适配器包同步版本号。

## 使用场景

在 React/Vue 适配器中，该功能已经作为默认引擎插件启用，通常不需要应用单独安装。独立 unified 项目可安装此包并将其加入自己的 remark 链。

## 语法边界

使用两个等号作为分隔符，遵循强调类语法的左右边界规则，处理空白、标点、转义与代码跨度。可以跨行，也可以与内部强调组合；它不是代码语法高亮器。

示例：`==**重要**内容==` 可产生 mark 中的 strong。代码跨度中的等号不会被当作标记。与其他 attention 扩展的组合受整体流水线影响，独立插件的固定对照语料不能证明任意 GFM 组合都等价。

完整安装示例、语法表与对照范围见[英文插件参考](english:docs/plugins/highlight/)。适配器用户查看[语法支持](../../apps/docs/content/guides/markdown-features.md)。
