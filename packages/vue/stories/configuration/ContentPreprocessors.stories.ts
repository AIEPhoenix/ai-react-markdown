import { EMPHASIS } from '@ai-markdown/storybook-kit/common/corpus';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Customization/Content Preprocessors',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Preprocessors transform the accumulated Markdown source before parsing. This corpus example uppercases text while retaining Markdown structure. Keep transformation function identities stable in application code; see Streaming/Error Recovery for remend.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
export const Preprocessors: Story = {
  render: () => ({
    setup: () => () => h(AIMarkdown, { content: EMPHASIS, contentPreprocessors: [(source) => source.toUpperCase()] }),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('INLINE-EMPHASIS'));
    expect(canvasElement.querySelector('strong')).not.toBeNull();
  },
};
