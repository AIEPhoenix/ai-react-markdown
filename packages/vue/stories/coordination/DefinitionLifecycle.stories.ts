import { REFERENCE_SCENARIO as scenario } from '@ai-markdown/storybook-kit/common/scenarios';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import AIMarkdown, { AIMarkdownDocuments } from '../../src';
const meta: Meta = {
  title: 'Documents/Definition Lifecycle',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Update, remove and restore a definition owner; then move a reader to another document. Only chunks sharing documentId inside the provider coordinate. The scenario and transitions match React Documents/Definition Lifecycle.',
      },
    },
  },
};
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
