# React 流式光标

streamingCursor 是组件插槽。React 适配器仅在 streaming=true 时将它挂载到 typography 容器内部；光标不是 Markdown 源文本的一部分。

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';

function StreamingMessage({ content, done }: { content: string; done: boolean }) {
  return (
    <div aria-busy={!done}>
      <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />
    </div>
  );
}
```

## 测量与隐藏

AIMarkdownStreamingCursor 测量最后一个可支持文本锚点，把视觉指示器叠放到末尾。代码、数学、SVG、图片、空内容、竖排文字及不能安全定位的尾部会隐藏它。它不会为了看似有进度而跳回较早的段落。

脚注定义的文本若在当前组件的脚注区可见，光标会跟随该定义；引用链接定义本身不可见，或脚注区由其他片段呈现时，不能跨 DOM 区域定位。

## 自定义指示器

通过 indicator 传入组件，其属性是 `height`、`width` 和 `lastMutationAt`。前两者是锚点字符的测量尺寸；最后一项是内容变更的 performance 时间，用于自行表现停顿。位置由外壳负责，不在自定义指示器契约中。

组件和包装函数应定义在模块作用域，避免每次 render 都卸载重挂载。指示器应保持小型，外壳不为它预留排版空间。

## 生命周期与可访问性

光标是 aria-hidden，应用在消息容器上管理 aria-busy 或状态区域。默认动画尊重 prefers-reduced-motion。服务器只输出不可见的惰性外壳，真实测量需要 DOM。

观察器与动画帧随卸载释放。纯属性引起的换行、旋转/斜切变换、Shadow DOM 或跨 iframe 动画样式有额外限制，详见[英文边界说明](english:docs/guides/streaming-cursor/)。不要用 source + 光标字符替代组件插槽，这会修改解析输入并破坏追加复用。
