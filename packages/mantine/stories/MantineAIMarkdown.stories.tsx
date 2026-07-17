import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@mantine/core';
import MantineAIMarkdown from '../src/index';
import 'katex/dist/katex.min.css';
import { withMantineProvider } from './decorators';
import { StreamingReplay } from '../../core/stories/streamingHelpers';

const meta: Meta<typeof MantineAIMarkdown> = {
  title: 'Mantine/MantineAIMarkdown',
  component: MantineAIMarkdown,
  argTypes: {
    content: { control: 'text', description: 'Raw markdown content to render.' },
    streaming: { control: 'boolean', description: 'Whether content is actively being streamed.' },
    fontSize: { control: 'text', description: 'Base font size (e.g. `"0.9375rem"`, `"14px"`, or a number for px).' },
    colorScheme: { table: { disable: true } },
    config: {
      control: 'object',
      description:
        'Partial render config, deep-merged with defaults. ' +
        'Includes `codeBlock.defaultExpanded`, `codeBlock.autoDetectUnknownLanguage`, ' +
        '`extraSyntaxSupported`, and `displayOptimizeAbilities`.',
    },
    metadata: { control: 'object', description: 'Arbitrary data passed to custom components via context.' },
    contentPreprocessors: { table: { disable: true } },
    customComponents: { table: { disable: true } },
    Typography: { table: { disable: true } },
    ExtraStyles: { table: { disable: true } },
    defaultConfig: { table: { disable: true } },
  },
  decorators: [withMantineProvider],
  render: (args) => <MantineAIMarkdown {...args} />,
};

export default meta;
type Story = StoryObj<typeof MantineAIMarkdown>;

export const Default: Story = {
  args: {
    content: '',
  },
};

export const CJKRenderErrorFix: Story = {
  args: {
    content:
      '这是一个**“会引起”**渲染错误的**“已知问题”**，当加重符号\\*\\*遇到某些中文标点时，可能就会出现**“识别不了”**的情况。就如这句话展现的一样。\n\n**このアスタリスクは強調記号として認識されず、そのまま表示されます。**この文のせいで。\n\n**该星号不会被识别，而是直接显示。**这是因为它没有被识别为强调符号。\n\n**이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)**이 문장 때문에.\n\n**~~このアスタリスクは強調記号として認識されず、そのまま表示されます。~~**この文のせいで。\n\n**~~该星号不会被识别，而是直接显示。~~**这是因为它没有被识别为强调符号。\n\n**~~이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)~~**이 문장 때문에.',
  },
};

/**
 * Streaming demo focused on the Mantine-specific renderers — mermaid diagrams
 * and highlighted code — arriving token by token.
 *
 * What to watch while it streams:
 * - Mermaid blocks show their raw source (plain code block) until the first
 *   prefix parses, then switch to the live SVG and refresh on each further
 *   successful parse. Parse failures mid-stream never flash the error tab;
 *   only the post-stream corrective pass may surface a real error.
 * - Code blocks re-highlight as lines arrive.
 *
 * Edit `content` in the Controls panel to stream your own markdown.
 */
export const Streaming: Story = {
  args: {
    content: [
      '# Mermaid 流式渲染演示',
      '',
      '下面的图会随着 token 流入逐步成形：先显示源码，首个可解析前缀出现后切换为 SVG，之后每次解析成功就刷新。',
      '',
      '```mermaid',
      'flowchart LR',
      '    A[用户提问] --> B{是否需要工具?}',
      '    B -- 是 --> C[调用工具]',
      '    B -- 否 --> D[直接回答]',
      '    C --> E[整合结果]',
      '    D --> E',
      '    E --> F[回复用户]',
      '```',
      '',
      '中间穿插一段普通内容，验证流式期间其他块不受影响：**加粗**、`行内代码`、公式 $E = mc^2$。',
      '',
      '```python',
      'def fibonacci(n: int) -> int:',
      '    a, b = 0, 1',
      '    for _ in range(n):',
      '        a, b = b, a + b',
      '    return a',
      '```',
      '',
      '## 第二张图：时序图',
      '',
      '```mermaid',
      'sequenceDiagram',
      '    participant U as 用户',
      '    participant A as 助手',
      '    participant T as 工具',
      '    U->>A: 提问',
      '    A->>T: 调用检索',
      '    T-->>A: 返回结果',
      '    A-->>U: 流式回答',
      '```',
      '',
      '| 阶段 | 显示内容 |',
      '| ---- | -------- |',
      '| 首个可解析前缀之前 | mermaid 源码 |',
      '| 流式中 | 最近一次成功渲染的 SVG |',
      '| 流式结束 | 最终代码的校正渲染 |',
      '',
      '流式结束后，所有图都应停在最终形态。',
      '',
    ].join('\n'),
    fontSize: '',
  },
  argTypes: {
    streaming: { table: { disable: true } },
  },
  parameters: {
    controls: { exclude: ['streaming'] },
  },
  render: (args) => (
    <StreamingReplay
      text={args.content ?? ''}
      renderButton={(streaming, restart) => (
        <Button size="xs" variant={streaming ? 'default' : 'filled'} onClick={restart} mb={12}>
          {streaming ? 'Streaming…' : 'Restart'}
        </Button>
      )}
    >
      {(content, streaming) => <MantineAIMarkdown {...args} content={content} streaming={streaming} />}
    </StreamingReplay>
  ),
};
