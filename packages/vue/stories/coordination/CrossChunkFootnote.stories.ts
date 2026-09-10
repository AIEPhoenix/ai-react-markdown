import { REFERENCE_SCENARIO as scenario } from '@ai-markdown/storybook-kit/common/scenarios';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import AIMarkdown, { AIMarkdownDocuments } from '../../src';
const meta: Meta = {
  title: 'Documents/Cross-Chunk Coordination',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Late definitions and repeated footnotes across ordered chunks. References, shared footers and backlinks must remain consistent when a reader unmounts. Purpose-built fixtures model arrival order that a complete corpus document cannot show.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
export const LateDefinitions: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The reader mounts before its definitions. Deliver definitions mounts a second chunk and resolves both the link and footnote without replacing the reader source. Remove definitions unmounts the owner and restores unresolved references. The second document never receives these definitions.',
      },
    },
  },
  render: () => ({
    setup() {
      const delivered = ref(false);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                delivered.value = !delivered.value;
              },
            },
            delivered.value ? 'Remove definitions' : 'Deliver definitions'
          ),
          h(AIMarkdownDocuments, null, {
            default: () => [
              h(AIMarkdown, { content: scenario.reader, documentId: 'late', documentIndex: 0, 'data-reader': '' }),
              delivered.value
                ? h(AIMarkdown, { content: scenario.definition, documentId: 'late', documentIndex: 1 })
                : null,
              h(AIMarkdown, { content: scenario.reader, documentId: 'separate', 'data-isolated': '' }),
            ],
          }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reader = () => canvasElement.querySelector('[data-reader]')!;
    await waitFor(() => expect(reader()).toHaveTextContent('[the source][site]'));
    expect(reader().querySelector('a[href="https://example.test/original"]')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Deliver definitions' }));
    await waitFor(() => expect(reader().querySelector('a[href="https://example.test/original"]')).not.toBeNull());
    await waitFor(() => expect(reader().querySelector('[data-footnote-ref]')).not.toBeNull());
    const reference = reader().querySelector('[data-footnote-ref]')!;
    const targetId = reference.getAttribute('href')!.slice(1);
    expect(Array.from(canvasElement.querySelectorAll('[id]')).find((node) => node.id === targetId)).toHaveTextContent(
      'Shared citation'
    );
    expect(canvasElement.querySelector('[data-isolated] a[href="https://example.test/original"]')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Remove definitions' }));
    await waitFor(() => expect(reader()).toHaveTextContent('[the source][site]'));
    expect(canvasElement.querySelector('[data-footnotes]')).toBeNull();
  },
};
export const RepeatedFootnotes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Two chunks cite the same footnote. The document assigns one number and distinct occurrence IDs, and renders a shared definition with backlinks. Removing a reader releases its occurrence; restoring it must not create duplicate DOM IDs or leave dangling anchors.',
      },
    },
  },
  render: () => ({
    setup() {
      const second = ref(true);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                second.value = !second.value;
              },
            },
            second.value ? 'Remove second reader' : 'Restore second reader'
          ),
          h(AIMarkdownDocuments, null, {
            default: () => [
              h(AIMarkdown, { content: scenario.reader, documentId: 'repeated', documentIndex: 0, key: 'first' }),
              second.value
                ? h(AIMarkdown, { content: scenario.reader, documentId: 'repeated', documentIndex: 1, key: 'second' })
                : null,
              h(AIMarkdown, {
                content: scenario.definition,
                documentId: 'repeated',
                documentIndex: 2,
                key: 'definition',
              }),
            ],
          }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const verify = async (count: number) =>
      waitFor(() => {
        const refs = Array.from(canvasElement.querySelectorAll('[data-footnote-ref]'));
        expect(refs).toHaveLength(count);
        expect(canvasElement.querySelectorAll('[data-footnote-backref]')).toHaveLength(count);
        expect(refs.map((node) => node.textContent)).toEqual(Array(count).fill('1'));
        const ids = Array.from(canvasElement.querySelectorAll('[id]')).map((node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const anchor of canvasElement.querySelectorAll('[data-footnote-ref], [data-footnote-backref]')) {
          expect(ids).toContain(anchor.getAttribute('href')!.slice(1));
        }
        expect(canvasElement.querySelectorAll('[data-footnotes] li')).toHaveLength(1);
      });
    await verify(2);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Remove second reader' }));
    await verify(1);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Restore second reader' }));
    await verify(2);
  },
};
