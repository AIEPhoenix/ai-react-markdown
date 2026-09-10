import { defineComponent, h, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown, { type MarkdownElementContext } from '../src';
import { EMPHASIS, LINKS, QUOTES } from '@ai-markdown/storybook-kit/common/corpus';
import { URL_SCHEMES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
const meta: Meta = { title: 'Customization/Components and Slots', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;
export const ScopedSlots: Story = {
  render: () => ({
    setup: () => () =>
      h(
        AIMarkdown,
        { content: EMPHASIS, metadata: 'Corpus emphasis' },
        {
          strong: ({ children, metadata }: MarkdownElementContext) =>
            h('strong', { 'data-slot': 'strong', title: String(metadata), style: { color: '#9c36b5' } }, children),
        }
      ),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="strong"]')).toHaveAttribute('title', 'Corpus emphasis')
    );
  },
};
const Quote = defineComponent({
  inheritAttrs: false,
  setup:
    (_, { slots }) =>
    () =>
      h(
        'blockquote',
        { 'data-component': 'quote', style: { borderInlineStart: '4px solid #1971c2', paddingInlineStart: '16px' } },
        slots.default?.()
      ),
});
export const ComponentMapping: Story = {
  render: () => ({ setup: () => () => h(AIMarkdown, { content: QUOTES, components: { blockquote: Quote } }) }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="quote"]')).not.toBeNull());
  },
};
export const ReactiveContent: Story = {
  render: () => ({
    setup() {
      const source = ref(EMPHASIS);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                source.value = QUOTES;
              },
            },
            'Replace source'
          ),
          h(AIMarkdown, { content: source.value }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Replace source' }));
    await waitFor(() => expect(canvasElement.querySelector('blockquote')).not.toBeNull());
    expect(canvasElement.textContent).not.toContain('inline-emphasis');
  },
};
export const LinkPolicy: Story = {
  render: () => ({
    setup: () => () =>
      h(AIMarkdown, { content: LINKS, urlTransform: (url) => (url.startsWith('https:') ? url : undefined) }),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('a[href]')).not.toBeNull());
    for (const a of canvasElement.querySelectorAll('a[href]')) expect(a.getAttribute('href')).toMatch(/^https:/);
  },
};
export const UnsafeURLs: Story = {
  render: () => ({ setup: () => () => h(AIMarkdown, { content: URL_SCHEMES_DOC }) }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('p')).not.toBeNull());
    for (const a of canvasElement.querySelectorAll('[href], [src]'))
      expect(a.getAttribute('href') ?? a.getAttribute('src')).not.toMatch(/^(javascript|vbscript):/i);
  },
};

export const Preprocessors: Story = {
  render: () => ({
    setup: () => () => h(AIMarkdown, { content: EMPHASIS, contentPreprocessors: [(source) => source.toUpperCase()] }),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('INLINE-EMPHASIS'));
    expect(canvasElement.querySelector('strong')).not.toBeNull();
  },
};
