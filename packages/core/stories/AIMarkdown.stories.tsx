import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown from '../src/index';
import 'katex/dist/katex.min.css';
import '../src/components/typography/variants/all.scss';
import { withThemedBackground } from './decorators';

const meta: Meta<typeof AIMarkdown> = {
  title: 'Core/AIMarkdown',
  component: AIMarkdown,
  argTypes: {
    content: { control: 'text', description: 'Raw markdown content to render.' },
    streaming: { control: 'boolean', description: 'Whether content is actively being streamed.' },
    fontSize: { control: 'text', description: 'Base font size (e.g. `"0.9375rem"`, `"14px"`, or a number for px).' },
    variant: { control: 'select', options: ['default'], description: 'Typography variant name.' },
    colorScheme: { table: { disable: true } },
    config: {
      control: 'object',
      description: 'Partial render config, deep-merged with defaults. Array values are replaced entirely.',
    },
    metadata: { control: 'object', description: 'Arbitrary data passed to custom components via context.' },
    contentPreprocessors: { table: { disable: true } },
    customComponents: { table: { disable: true } },
    Typography: { table: { disable: true } },
    ExtraStyles: { table: { disable: true } },
    defaultConfig: { table: { disable: true } },
  },
  decorators: [withThemedBackground],
  render: (args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    return <AIMarkdown {...args} colorScheme={currentTheme} />;
  },
};

export default meta;
type Story = StoryObj<typeof AIMarkdown>;

export const Default: Story = {
  args: {
    content: '',
  },
};

export const CJKRenderErrorFix: Story = {
  args: {
    content:
      '这是一个**“会引起”**渲染错误的**“已知问题”**，当加重符号\\*\\*遇到某些中文标点时，可能就会出现**“识别不了”**的情况。就如这句话展现的一样。\n\n**このアスタリスクは強調記号として認識されず、そのまま表示されます。**この文のせいで。\n\n**该星号不会被识别，而是直接显示。**这是因为它没有被识别为强调符号。\n\n**이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)**이 문장 때문에.\n\n**~~このアスタリスクは強調記号として認識されず、そのまま表示されます。~~**この文のせいで。\n\n**~~该星号不会被识别，而是直接显示。~~**这是因为它没有被识别为强调符号。\n\n**~~이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)~~**이 문장 때문에.',
    fontSize: '',
  },
};
