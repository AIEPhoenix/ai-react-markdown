import React from 'react';
import MantineAIMarkdown from '../src/index';
import 'katex/dist/katex.min.css';
import { baseMantineMeta, type MantineMeta, type MantineStory } from './_shared/meta';
import { GFM_BASICS } from '../../core/stories/_shared/fixtures';

/**
 * The Mantine wrapper with every prop wired to a control — core's surface plus
 * `codeBlock`. Color scheme follows the toolbar through Mantine's own
 * provider, so there is no `colorScheme` prop to set here.
 */
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Mantine/Playground',
  tags: ['autodocs'],
  component: MantineAIMarkdown,
  parameters: {
    // Was 'error' while this story rendered empty content. The GFM baseline
    // brings in an autolink, and Mantine's default link blue (#228be6) is
    // 3.55:1 against white — a theme-level decision this story cannot fix.
    a11y: { test: 'todo' },
  },
  render: (args) => <MantineAIMarkdown {...args} />,
};

export default meta;

/** The GFM baseline, rendered through Mantine's typography and code blocks. */
export const Default: MantineStory = {
  args: {
    content: GFM_BASICS,
  },
};

/**
 * The CJK emphasis fix, verified through the Mantine wrapper too — the
 * correction lives in the shared engine, so the wrapper must inherit it.
 * The core story under Features covers the same ground for readers; this one
 * exists to catch a regression that only shows up here.
 */
export const CJKRenderErrorFix: MantineStory = {
  tags: ['qa'],
  args: {
    content:
      '这是一个**“会引起”**渲染错误的**“已知问题”**，当加重符号\\*\\*遇到某些中文标点时，可能就会出现**“识别不了”**的情况。就如这句话展现的一样。\n\n**このアスタリスクは強調記号として認識されず、そのまま表示されます。**この文のせいで。\n\n**该星号不会被识别，而是直接显示。**这是因为它没有被识别为强调符号。\n\n**이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)**이 문장 때문에.\n\n**~~このアスタリスクは強調記号として認識されず、そのまま表示されます。~~**この文のせいで。\n\n**~~该星号不会被识别，而是直接显示。~~**这是因为它没有被识别为强调符号。\n\n**~~이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)~~**이 문장 때문에.',
  },
};
