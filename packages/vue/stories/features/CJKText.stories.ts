import { CJK_MIXED_DOC, CJK_EMPHASIS_REGRESSION, RTL_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
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

export const EmphasisPunctuationFix: Story = {
  args: { content: CJK_EMPHASIS_REGRESSION },
  parameters: {
    docs: {
      description: {
        story:
          'The same punctuation regression fixture as React. Chinese, Japanese and Korean emphasis next to full-width punctuation must form semantic strong/del elements. This is a deliberate syntax fixture, not a Vue installation example.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('strong').length).toBeGreaterThan(5));
    expect(canvasElement.querySelector('strong del, del strong')).not.toBeNull();
    expect(canvasElement.textContent).toContain('별표');
  },
};
export const RTL: Story = {
  args: { content: RTL_DOC },
  parameters: {
    docs: {
      description: {
        story:
          'Direction is owned by the application container. An explicit dir="rtl" displays the shared Arabic fixture, including lists, quotes and inline Latin code, without changing the Markdown parser.',
      },
    },
  },
  render: (args) => ({
    setup: () => () => h('section', { dir: 'rtl' }, [h(AIMarkdown, { content: args.content ?? RTL_DOC })]),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('blockquote')).not.toBeNull());
    expect(getComputedStyle(canvasElement.querySelector('blockquote')!).direction).toBe('rtl');
    expect(canvasElement.querySelectorAll('li')).toHaveLength(3);
    expect(canvasElement.querySelector('code')).toHaveTextContent('streaming');
  },
};
