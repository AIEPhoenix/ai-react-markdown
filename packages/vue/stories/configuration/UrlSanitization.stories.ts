import { LINKS } from '@ai-markdown/storybook-kit/common/corpus';
import { URL_SCHEMES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Customization/URL Sanitization',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Default URL policy blocks dangerous schemes before custom rendering. A custom urlTransform can further restrict links. These examples reuse React policy fixtures and corpus links; sanitizer policy is distinct from UI styling.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
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
