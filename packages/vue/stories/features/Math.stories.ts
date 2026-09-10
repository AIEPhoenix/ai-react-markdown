import { sampleReplay } from '../_shared/sampleReplay';
import { MATH_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor, userEvent, within } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Basics/Math',
  tags: ['autodocs'],
  component: AIMarkdown,
  render: (args) => ({ setup: () => () => h(AIMarkdown, { ...args, content: args.content ?? '' }) }),
  argTypes: { content: { control: 'text' } },
  parameters: {
    docs: {
      description: {
        component:
          'Corpus math is rendered with KaTeX. Inline and display formulas share the engine pipeline with React. The catalog imports KaTeX CSS; applications must import it too. Edit source to inspect formula changes.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof AIMarkdown>;
export const Math: Story = {
  args: { content: MATH_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.katex')).not.toBeNull());
  },
};

export const StreamingMath: Story = {
  argTypes: { content: { table: { disable: true } } },
  parameters: {
    docs: {
      description: {
        story:
          'Replay the same source used by the static example as accumulated snapshots. Complete sample delivers the remaining source and ends streaming. This checks the completed output and supports restarting a new replay; the helper cancels its timer on unmount.',
      },
    },
  },
  render: () => sampleReplay(MATH_DOC),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Replay sample' }));
    await waitFor(() => expect(canvasElement.querySelector('.aimd-vue')?.textContent?.length).toBeGreaterThan(0));
    await userEvent.click(canvas.getByRole('button', { name: 'Complete sample' }));
    await waitFor(() => expect(canvasElement.querySelector('.katex')).not.toBeNull());
    await waitFor(() => expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull());
    expect(Array.from(canvasElement.querySelectorAll('.katex annotation')).at(-1)?.textContent?.trim()).toBe(
      MATH_DOC.split('$$').at(-2)?.trim()
    );
  },
};
