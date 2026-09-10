import { GFM_BASICS } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Basics/Markdown Basics',
  tags: ['autodocs'],
  component: AIMarkdown,
  render: (args) => ({ setup: () => () => h(AIMarkdown, { ...args, content: args.content ?? '' }) }),
  argTypes: { content: { control: 'text' } },
  parameters: {
    docs: {
      description: {
        component:
          'Headings, emphasis, tables, task lists and quotes use the same corpus excerpts as React. Edit the complete Markdown source in Controls. Code fences are plain pre/code elements; syntax highlighting requires an application integration.',
      },
    },
  },
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
