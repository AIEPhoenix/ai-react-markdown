import { sampleReplay } from '../_shared/sampleReplay';
import { DEFINITION_LIST_DOC, FOOTNOTES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor, userEvent, within } from 'storybook/test';
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

export const FootnotesStreaming: Story = {
  argTypes: { content: { table: { disable: true } } },
  parameters: {
    docs: {
      description: {
        story:
          'Replay the same source used by the static example as accumulated snapshots. Complete sample delivers the remaining source and ends streaming. This checks the completed output and supports restarting a new replay; the helper cancels its timer on unmount.',
      },
    },
  },
  render: () => sampleReplay(FOOTNOTES_DOC),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Replay sample' }));
    await waitFor(() => expect(canvasElement.querySelector('.aimd-vue')?.textContent?.length).toBeGreaterThan(0));
    await userEvent.click(canvas.getByRole('button', { name: 'Complete sample' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-footnotes]')).not.toBeNull());
    await waitFor(() => expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull());
    const ids = new Set(Array.from(canvasElement.querySelectorAll('[id]')).map((node) => node.id));
    const links = canvasElement.querySelectorAll('[data-footnote-ref], [data-footnote-backref]');
    expect(links.length).toBeGreaterThan(4);
    for (const link of links) expect(ids.has(link.getAttribute('href')!.slice(1))).toBe(true);
  },
};
