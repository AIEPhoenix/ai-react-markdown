import { h } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import AIMarkdown from '../src';
import {
  GFM_BASICS,
  MATH_DOC,
  CJK_MIXED_DOC,
  FOOTNOTES_DOC,
  DEFINITION_LIST_DOC,
  MARK_HIGHLIGHT_DOC,
} from '@ai-markdown/storybook-kit/common/fixtures';
const meta: Meta<typeof AIMarkdown> = {
  title: 'Basics/Markdown',
  component: AIMarkdown,
  tags: ['autodocs'],
  render: (args) => ({ setup: () => () => h(AIMarkdown, args) }),
};
export default meta;
type Story = StoryObj<typeof AIMarkdown>;
export const GFM: Story = {
  args: { content: GFM_BASICS },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('table')).not.toBeNull());
    expect(canvasElement.querySelector('input[type="checkbox"][disabled]')).not.toBeNull();
  },
};
export const Math: Story = {
  args: { content: MATH_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.katex')).not.toBeNull());
  },
};
export const CJK: Story = {
  args: { content: CJK_MIXED_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('strong')).not.toBeNull());
  },
};
export const Footnotes: Story = {
  args: { content: FOOTNOTES_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-footnotes]')).not.toBeNull());
  },
};
export const DefinitionLists: Story = {
  args: { content: DEFINITION_LIST_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('dl')).not.toBeNull());
  },
};
export const Highlight: Story = {
  args: { content: MARK_HIGHLIGHT_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('mark')).not.toBeNull());
  },
};
export const PluginsDisabled: Story = {
  args: { content: MARK_HIGHLIGHT_DOC, enginePlugins: [] },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('=='));
    expect(canvasElement.querySelector('mark')).toBeNull();
  },
};
