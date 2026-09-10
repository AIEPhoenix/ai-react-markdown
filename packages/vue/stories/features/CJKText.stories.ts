import { CJK_MIXED_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Basics/CJK & International Text',
  tags: ['autodocs'],
  component: AIMarkdown,
  render: (args) => ({ setup: () => () => h(AIMarkdown, { ...args, content: args.content ?? '' }) }),
  argTypes: { content: { control: 'text' } },
  parameters: {
    docs: {
      description: {
        component:
          'Purpose-built CJK fixtures exercise punctuation and emphasis boundaries. The Markdown content is shared with React; font selection and paragraph layout remain application-owned.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof AIMarkdown>;
export const CJK: Story = {
  args: { content: CJK_MIXED_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('strong')).not.toBeNull());
  },
};
