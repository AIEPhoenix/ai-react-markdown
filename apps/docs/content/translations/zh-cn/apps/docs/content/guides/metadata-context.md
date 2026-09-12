# React 元数据

metadata 将应用数据传给深层自定义元素，避免逐层传递。它使用独立上下文，与主题、流式状态和行为组分开。

```tsx
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownCustomComponents } from '@ai-markdown/react';

interface ChatMeta {
  messageId: string;
  onCopyCode: (code: string) => void;
  onCitationClick: (label: string) => void;
}

const CopyablePre: NonNullable<AIMarkdownCustomComponents['pre']> = ({ node, children, ...props }) => {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  const code = node?.children[0];
  const source =
    code?.type === 'element' && code.tagName === 'code'
      ? code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      : '';
  return (
    <div>
      <button type="button" disabled={!meta} onClick={() => meta?.onCopyCode(source)}>
        Copy code
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
};
const COMPONENTS = { pre: CopyablePre } satisfies AIMarkdownCustomComponents;

<AIMarkdown<ChatMeta>
  content={markdown}
  metadata={{ messageId: msg.id, onCopyCode: handleCopy, onCitationClick: handleCitation }}
  customComponents={COMPONENTS}
/>;
```

## 读取与类型

使用 useAIMarkdownMetadata<T>() 读取 T 或 undefined；没有提供元数据时要处理 undefined。useAIMarkdown<T>() 可读取聚合上下文，但订阅范围更大。

AIMarkdownProps<TMetadata> 把组件配置与数据类型关联起来。泛型不是运行时校验，不应将不可信数据仅通过类型断言当作安全数据。

## 更新与性能

库故意不稳定 metadata，应用决定对象身份。内容不变时可使用 memoized 数据；需要通知变化时提供新值，不要原地修改对象。独立上下文减少无关通知，但正常父组件重渲染仍可能发生。

元数据应携带渲染需要的应用信息，不应把它当作全局状态仓库或安全边界。参见[Hooks 参考](api/react-hooks.md)和[英文实例](english:docs/guides/metadata-context/)。
