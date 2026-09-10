import { CODE, EMPHASIS, MATH } from '@ai-markdown/storybook-kit/common/corpus';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Streaming/Streaming Cursor',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A cursor follows visible prose and hides for code/math tails. Vue owns DOM measurement and observer cleanup. Customize the cursor slot without changing its placement contract. Corpus excerpts match the renderer baseline.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
export const CursorTailKinds: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The cursor slot customizes the marker, while streamingCursor enables its placement. Text tails show a marker; code and math tails hide it rather than pointing at an earlier paragraph. Finishing removes the cursor. The buttons switch between unmodified corpus excerpts.',
      },
    },
  },
  render: () => ({
    setup() {
      const source = ref(EMPHASIS);
      const streaming = ref(true);
      return () =>
        h('section', [
          ...(
            [
              ['Text tail', EMPHASIS],
              ['Code tail', CODE],
              ['Math tail', MATH],
            ] as const
          ).map(([label, content]) =>
            h(
              'button',
              {
                onClick: () => {
                  source.value = content;
                  streaming.value = true;
                },
              },
              label
            )
          ),
          h(
            'button',
            {
              onClick: () => {
                streaming.value = false;
              },
            },
            'Finish'
          ),
          h(
            AIMarkdown,
            { content: source.value, streaming: streaming.value, streamingCursor: true },
            { cursor: () => h('span', { 'data-custom-cursor': '' }, '▌') }
          ),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cursor = () => canvasElement.querySelector('.aimd-vue-cursor') as HTMLElement;
    await waitFor(() => expect(cursor()).toBeVisible());
    expect(canvasElement.querySelector('[data-custom-cursor]')).not.toBeNull();
    for (const [name, selector] of [
      ['Code tail', 'pre code'],
      ['Math tail', '.katex'],
    ] as const) {
      await userEvent.click(canvas.getByRole('button', { name }));
      await waitFor(() => {
        expect(canvasElement.querySelector(selector)).not.toBeNull();
        expect(cursor()).not.toBeNull();
        expect(cursor()).not.toBeVisible();
      });
    }
    await userEvent.click(canvas.getByRole('button', { name: 'Text tail' }));
    await waitFor(() => expect(cursor()).toBeVisible());
    await userEvent.click(canvas.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(cursor()).toBeNull());
  },
};
