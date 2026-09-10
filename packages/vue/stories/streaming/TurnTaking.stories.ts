import { EMPHASIS, QUOTES } from '@ai-markdown/storybook-kit/common/corpus';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import { AIMarkdownDocuments, AIMarkdownSmoothStream } from '../../src';
const meta: Meta = {
  title: 'Streaming/Turn Taking',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Smooth chunks inside AIMarkdownDocuments share documentId and take turns by registration order. A successor mounted empty waits for its predecessor to finish or unmount. documentIndex orders references, not smooth turns. Compare the React chapter of the same name.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
export const CancelPredecessor: Story = {
  render: () => ({
    setup() {
      const started = ref(false);
      const predecessor = ref(true);
      const producing = ref(true);
      const source = ref('');
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                source.value = QUOTES;
                started.value = true;
              },
            },
            'Queue successor'
          ),
          h(
            'button',
            {
              onClick: () => {
                predecessor.value = false;
              },
            },
            'Unmount predecessor'
          ),
          h(
            'button',
            {
              onClick: () => {
                producing.value = false;
              },
            },
            'Finish predecessor'
          ),
          h(AIMarkdownDocuments, null, {
            default: () => [
              predecessor.value
                ? h(AIMarkdownSmoothStream, {
                    content: EMPHASIS,
                    streaming: producing.value,
                    documentId: 'queue',
                    key: 'first',
                  })
                : null,
              h(
                AIMarkdownSmoothStream,
                {
                  content: source.value,
                  streaming: !started.value,
                  documentId: 'queue',
                  key: 'second',
                  'data-successor': '',
                  pacing: 'responsive',
                },
                { waiting: () => h('span', 'Waiting for predecessor') }
              ),
            ],
          }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Queue successor' }));
    await waitFor(() => expect(canvas.getByText('Waiting for predecessor')).toBeInTheDocument());
    expect(canvasElement.querySelector('[data-successor] blockquote')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Unmount predecessor' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-successor] blockquote')).not.toBeNull(), {
      timeout: 10000,
    });
    await waitFor(() => expect(canvas.queryByText('Waiting for predecessor')).toBeNull());
  },
};
export const CompletePredecessor: Story = {
  render: CancelPredecessor.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Queue successor' }));
    await waitFor(() => expect(canvas.getByText('Waiting for predecessor')).toBeInTheDocument());
    expect(canvasElement.querySelector('[data-successor] blockquote')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Finish predecessor' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-successor] blockquote')).not.toBeNull(), {
      timeout: 10000,
    });
    await waitFor(() => expect(canvas.queryByText('Waiting for predecessor')).toBeNull());
  },
};
