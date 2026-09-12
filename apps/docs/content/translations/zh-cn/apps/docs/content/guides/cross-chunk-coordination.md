# React 文档与引用

使用 AIMarkdownDocuments 包围属于同一协调范围的渲染器，并给同一逻辑文档的每个片段传入相同的显式 documentId。基础 blockMemo 必须开启。

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/react';

interface Message {
  id: string;
  chunks: { id: string; markdown: string }[];
}

function StreamedMessage({ message }: { message: Message }) {
  return (
    <AIMarkdownDocuments>
      {message.chunks.map((chunk, index) => (
        <AIMarkdown key={chunk.id} content={chunk.markdown} documentId={message.id} documentIndex={index} />
      ))}
    </AIMarkdownDocuments>
  );
}
```

## 身份与顺序

自动 useId 仅用于独立渲染器，不会自动开启跨片段协调。较长 ID 在 HTML 前缀内部缩短，但 hook 和 registry 中的文档 ID 保持原值。不要自行依赖生成前缀的字节格式。

引用默认按注册顺序组织。可能乱序挂载或重挂载时设置稳定 documentIndex。它不改变平滑输出的挂载队列顺序。逻辑文档可以共享定义，但不能将跨组件的半个公式或围栏拼接起来。

## 容器属性

preserveOrphanReferences 默认 true，无条件覆盖后代渲染器的同名孤立引用策略。smoothTurnTaking 默认 true，控制平滑片段轮流呈现。容器不添加排版 DOM。

禁止嵌套容器：开发环境抛错；生产环境记录错误，内部容器成为空操作，子树使用外层容器。

## 读取 registry

`useDocumentRegistry(documentId, documentIdExplicit = true)` 返回只读 Registry，容器不存在、ID 为空或 explicit=false 时返回 null。它本身不注册片段，也不会订阅 registry 内容变化。

Registry 提供版本、只读索引、全局/标签订阅与解析查询。需要 React 响应式读取时，用 useSyncExternalStore 包装订阅和快照，并确保退订。方法可能依赖 this，不要直接解构后调用。不要修改返回定义、快照或内部集合。

原始定义 URL 不是已经通过最终策略的 DOM 属性。自定义链接也必须应用 URL 策略；框架内部的协调占位符使用共享解析器执行清洗、hash 前缀调整与最终 URL 转换。

## 生命周期与 SSR

只在 React commit 后发布贡献，放弃的 render 不得改动共享文档。卸载配对释放，最后成员清理可以延迟到微任务；旧清理不能误删新的 registry。服务端只使用片段本地定义，挂载后共享贡献才可读。

完整 Registry 字段表与订阅示例见[英文详细参考](english:docs/guides/cross-chunk-coordination/)。
