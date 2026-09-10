import { DEFINITION_LIST_DOC, FOOTNOTES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Basics/Footnotes & Definition Lists',
  tags: ['autodocs'],
  component: AIMarkdown,
  render: (args) => ({ setup: () => () => h(AIMarkdown, { ...args, content: args.content ?? '' }) }),
  argTypes: { content: { control: 'text' } },
  parameters: {
    docs: {
      description: {
        component:
          'Standalone footnote numbering, backlinks and semantic definition lists. These syntax fixtures are shared with React. For definitions arriving in a sibling chunk, use Documents/Cross-Chunk Coordination.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof AIMarkdown>;
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
