import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown, { AIMarkdownDocuments } from '../../src';
import '../../src/components/typography/variants/all.scss';
import { REFERENCE_SCENARIO as scenario } from '@ai-markdown/storybook-kit/common/scenarios';
function DefinitionLifecycle() {
  const [definition, setDefinition] = useState<string | null>(scenario.definition);
  const [documentId, setDocumentId] = useState('answer');
  return (
    <section>
      <button onClick={() => setDefinition(scenario.updated)}>Update definition</button>
      <button onClick={() => setDefinition(null)}>Remove definition</button>
      <button onClick={() => setDefinition(scenario.definition)}>Restore definition</button>
      <button onClick={() => setDocumentId('other')}>Switch reader document</button>
      <AIMarkdownDocuments>
        <div data-reader>
          <AIMarkdown content={scenario.reader} documentId={documentId} documentIndex={0} />
        </div>
        {definition !== null && <AIMarkdown content={definition} documentId="answer" documentIndex={1} />}
        <div data-isolated>
          <AIMarkdown content={scenario.reader} documentId="isolated" />
        </div>
      </AIMarkdownDocuments>
    </section>
  );
}
const meta: Meta = { title: 'Documents/Definition Lifecycle', tags: ['autodocs'] };
export default meta;
export const Interactive: StoryObj = {
  render: () => <DefinitionLifecycle />,
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
