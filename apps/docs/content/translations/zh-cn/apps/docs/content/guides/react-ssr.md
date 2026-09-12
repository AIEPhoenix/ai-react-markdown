# React SSR 与水合

React 适配器使用 React 19。服务器可渲染 Markdown HTML；需要上下文、effects 和 DOM 测量的部分由客户端生命周期接管。RSC 应用应在合适的位置建立客户端边界。

## 保持首帧一致

服务端与客户端使用相同的初始 source、文档身份和配置。服务端执行完整解析；不要将浏览器测量结果写入服务端渲染逻辑。按宿主规则导入全局 CSS，包括数学所需的 KaTeX 样式。

```tsx
'use client';

import AIMarkdown from '@ai-markdown/react';

export function MarkdownAnswer({ content }: { content: string }) {
  return <AIMarkdown content={content} />;
}
```

## 平滑输出与延迟水合

初始已有内容直接显示，挂载或水合不从空字符串重播。后续追加才进入动画。服务端快照必须读取本次渲染的完整内容，不能用过时的控制器可见前缀替代延迟水合时的 source。

## 跨片段引用

服务器只解析本地可见定义。共享贡献在 React commit 后发布，不能在 render 阶段注册或发布；放弃的 render 不应影响已提交文档。挂载后订阅推动跨片段引用更新。

会话与容器应属于自己的组件或请求，不能在无关请求之间共享可变状态。检查初始 HTML、水合警告、内容替换、晚到定义与卸载，而不只检查一次 renderToString 成功。

更多细节见[文档协调](cross-chunk-coordination.md)与[平滑输出](smooth-streaming.md)。
