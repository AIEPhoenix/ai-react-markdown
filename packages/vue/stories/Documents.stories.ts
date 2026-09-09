import { h, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown, { AIMarkdownDocuments, AIMarkdownSmoothStream } from '../src';
import { REFERENCE_SCENARIO as scenario } from '@ai-markdown/storybook-kit/common/scenarios';
import { EMPHASIS, QUOTES } from '@ai-markdown/storybook-kit/common/corpus';
const meta: Meta = { title: 'Documents/Coordination', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;
export const DefinitionLifecycle: Story = {
  render: () => ({
    setup() {
      const definition = ref<string | null>(scenario.definition);
      const documentId = ref('answer');
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                definition.value = scenario.updated;
              },
            },
            'Update definition'
          ),
          h(
            'button',
            {
              onClick: () => {
                definition.value = null;
              },
            },
            'Remove definition'
          ),
          h(
            'button',
            {
              onClick: () => {
                definition.value = scenario.definition;
              },
            },
            'Restore definition'
          ),
          h(
            'button',
            {
              onClick: () => {
                documentId.value = 'other';
              },
            },
            'Switch reader document'
          ),
          h(AIMarkdownDocuments, null, {
            default: () => [
              h(AIMarkdown, {
                content: scenario.reader,
                documentId: documentId.value,
                documentIndex: 0,
                'data-reader': '',
              }),
              definition.value === null
                ? null
                : h(AIMarkdown, { content: definition.value, documentId: 'answer', documentIndex: 1 }),
              h(AIMarkdown, { content: scenario.reader, documentId: 'isolated', 'data-isolated': '' }),
            ],
          }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reader = () => canvasElement.querySelector('[data-reader]');
    await waitFor(() => expect(reader()?.querySelector('a[href="https://example.test/original"]')).not.toBeNull());
    expect(canvasElement.querySelector('[data-isolated] a[href="https://example.test/original"]')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Update definition' }));
    await waitFor(() => expect(reader()?.querySelector('a[href="https://example.test/revised"]')).not.toBeNull());
    await waitFor(() => expect(canvasElement.textContent).toContain('Revised citation'));
    await userEvent.click(canvas.getByRole('button', { name: 'Remove definition' }));
    await waitFor(() => expect(reader()?.querySelector('a[href="https://example.test/revised"]')).toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Restore definition' }));
    await waitFor(() => expect(reader()?.querySelector('a[href="https://example.test/original"]')).not.toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Switch reader document' }));
    await waitFor(() => expect(reader()?.querySelector('a[href="https://example.test/original"]')).toBeNull());
  },
};
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
