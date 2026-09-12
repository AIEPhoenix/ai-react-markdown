# React 平滑流式输出

平滑层将突发到达的累积文本按字素簇呈现。初始内容和非追加替换直接显示，后续追加逐步展开。它不改变网络协议，也不取消请求。

```tsx
import { AIMarkdownSmoothStream, AIMarkdownStreamingCursor } from '@ai-markdown/react';

<AIMarkdownSmoothStream
  content={message.markdown}
  streaming={message.pending}
  streamingCursor={AIMarkdownStreamingCursor}
/>;
```

## 组件属性

AIMarkdownSmoothStream 继承 React 基础属性，增加以下配置：

| 属性                 | 默认值     | 含义                                                       |
| -------------------- | ---------- | ---------------------------------------------------------- |
| `smoothPacing`       | `balanced` | smooth / balanced / responsive 三种预设，运行中可更新      |
| `onSmoothDrained`    | 未设置     | 真正积压的一轮内容排空后回调                               |
| `smoothWaiting`      | false      | 尚未收到输入时保留空片段的队列位置；开始或空结果完成时清除 |
| `smoothCoordination` | true       | 是否参与文档轮流呈现                                       |

## Hooks

`useSmoothStream(options)` 接收 content（必填完整字符串）、streaming（默认 false）、pacing（默认 balanced）和 onDrained。返回 `{ content, streaming, flush }`：content 是可见前缀，streaming 在生产端活跃或仍有内容待显示时为 true，flush 的函数身份稳定。

初始/静态 snap 与源文本替换不触发完成回调。回调可换身份，下一次已提交的 effect 更新它。卸载取消调度并释放订阅。

高级测试可注入 `now: () => number` 与 `schedule: (callback) => cancel`；二者在控制器创建时捕获，后续 render 替换它们不会重建控制器。schedule 必须异步执行，并返回取消函数。

## 文档轮流呈现

`useDocumentSmoothStream` 额外接收 documentId 与 waiting（默认 false）。需要匹配渲染器的 ID，且 React 手动 hook 路径的 ID 必须在挂载期间稳定。没有 ID、没有文档容器，或关闭 smoothTurnTaking 时，按普通 hook 工作。

空内容挂载的片段等待前序片段结束并排空；带内容挂载的片段直接显示。播放顺序遵循挂载队列，不由 documentIndex 重新排序。等待期间 flush 无操作；onDrained 在本片段完成播放后触发。完全发生在等待期间的替换最终仍可能产生完成回调，因为呈现层只见到了最终内容。

## 常见边界

活跃流会暂留最后一个未确认字素，flush 不会冒充它已完成。生成结束必须设 streaming=false。新消息使用新身份，避免复用已经完成的队列成员。虚拟列表卸载正在播放的片段会释放后继。减少动画偏好应由应用通过调整策略或跳过动画处理。

高级数值参数属于 engine 控制器，而不是这些 React 组件属性。参数解释与排队场景见[英文详细参考](english:docs/guides/smooth-streaming/)。
