import { h } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import AIMarkdown from '../src';
import { SHOWCASE } from '@ai-markdown/storybook-kit/common/corpus';

const meta: Meta<typeof AIMarkdown> = {
  title: 'Playground',
  component: AIMarkdown,
  tags: ['autodocs'],
  args: { content: SHOWCASE, streaming: false, incrementalParse: true, streamingCursor: true },
  argTypes: {
    content: { control: 'text', description: 'Complete accumulated Markdown. Sample: corpus/documents excerpts.' },
    streaming: { control: 'boolean' },
    incrementalParse: { control: 'boolean' },
    streamingCursor: { control: 'boolean' },
    preserveOrphanReferences: { control: 'boolean' },
    enginePlugins: { table: { disable: true } },
    components: { table: { disable: true } },
    contentPreprocessors: { table: { disable: true } },
    urlTransform: { table: { disable: true } },
  },
  render: (args) => ({ setup: () => () => h(AIMarkdown, args) }),
  parameters: {
    docs: {
      description: {
        component:
          'Edit content and flags in Controls. Vue 3.5+ renders VNodes through the shared core and engine. Styles and KaTeX CSS are installed by this catalog preview.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof AIMarkdown>;
export const Interactive: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('table')).not.toBeNull();
      expect(canvasElement.querySelector('pre code')).not.toBeNull();
      expect(canvasElement.querySelector('.katex')).not.toBeNull();
    });
  },
};
