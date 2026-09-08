import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import MantineAIMarkdown from '../src/index';
import { withMantineProvider } from './decorators';

const meta: Meta = { title: 'Mantine/QA/Code content integrity', tags: ['qa'], decorators: [withMantineProvider] };
export default meta;
const json = '{"id":9007199254740993,"nested":"{\\"a\\":1}"}\n';

export const DisplayAndCopy: StoryObj = {
  render: () => (
    <>
      <div data-case="json">
        <MantineAIMarkdown content={'```json\n' + json + '```'} />
      </div>
      <div data-case="raw">
        <MantineAIMarkdown content={'<pre><code>alpha <b>beta</b></code> gamma</pre>'} />
      </div>
      <div data-case="no-format">
        <MantineAIMarkdown content={'```json\n' + json + '```'} codeBlock={{ formatJson: false }} />
      </div>
    </>
  ),
  play: async ({ canvasElement }) => {
    const target = canvasElement.querySelector('[data-case="json"]') as HTMLElement;
    expect(target.textContent).toContain('9007199254740993');
    expect(canvasElement.querySelector('[data-case="raw"]')?.textContent).toContain('alpha beta gamma');
    expect(canvasElement.querySelector('[data-case="no-format"] code')?.textContent).toBe(json.trimEnd());
    const clipboard = navigator.clipboard;
    const original = clipboard.writeText;
    let copied = '';
    clipboard.writeText = async (value: string) => {
      copied = value;
    };
    try {
      await userEvent.click(within(target).getByRole('button', { name: 'Copy code' }));
      await waitFor(() => expect(copied).toBe(json));
    } finally {
      clipboard.writeText = original;
    }
  },
};
