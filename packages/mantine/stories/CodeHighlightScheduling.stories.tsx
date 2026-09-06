import { useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../src/index';
import { withMantineProvider } from './decorators';

const meta: Meta = { title: 'Mantine/QA/Code highlight scheduling', tags: ['qa'], decorators: [withMantineProvider] };
export default meta;
const replacementAdapter = {
  getHighlighter: () => () => ({
    isHighlighted: false,
    highlightedCode: '',
    codeElementProps: { 'data-adapter': 'replacement' },
  }),
};
const line = 'const result = items.map((item) => ({ ...item, score: item.value * 2 }));\n';
function Harness({ interval }: { interval: number }) {
  const calls = useRef(0);
  const codeBlock = useMemo(() => ({ highlightIntervalMs: interval }), [interval]);
  const [adapter] = useState(() => {
    const highlight = createHighlightJsAdapter(hljs).getHighlighter(undefined);
    return {
      getHighlighter: () => (input: Parameters<typeof highlight>[0]) => {
        calls.current++;
        return highlight(input);
      },
    };
  });
  const [count, setCount] = useState(1);
  const [language, setLanguage] = useState('javascript');
  const [replaceAdapter, setReplaceAdapter] = useState(false);
  const [streaming, setStreaming] = useState(true);
  const [reported, setReported] = useState(0);
  return (
    <>
      <button
        onClick={() => {
          calls.current = 0;
        }}
      >
        Reset count
      </button>
      <button onClick={() => setCount((n) => n + 1)}>Append</button>
      <button onClick={() => setReported(calls.current)}>Report count</button>
      <button onClick={() => setStreaming(false)}>Finish</button>
      <button onClick={() => setLanguage('python')}>Switch language</button>
      <button onClick={() => setReplaceAdapter(true)}>Switch adapter</button>
      <output aria-label="Highlight calls">{reported}</output>
      <CodeHighlightAdapterProvider adapter={replaceAdapter ? replacementAdapter : adapter}>
        <MantineAIMarkdown
          content={'```' + language + '\n' + line.repeat(count) + '```'}
          streaming={streaming}
          codeBlock={codeBlock}
        />
      </CodeHighlightAdapterProvider>
    </>
  );
}

export const CoalescedAndCopyLatest: StoryObj = {
  render: () => <Harness interval={10000} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Reset count' }));
    for (let i = 0; i < 20; i++) await userEvent.click(canvas.getByRole('button', { name: 'Append' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Report count' }));
    expect(canvas.getByLabelText('Highlight calls').textContent).toBe('0');
    expect(canvasElement.querySelector('code')?.textContent).toBe(line.trimEnd());
    const original = navigator.clipboard.writeText;
    let copied = '';
    navigator.clipboard.writeText = async (value) => {
      copied = value;
    };
    try {
      await userEvent.click(canvas.getByRole('button', { name: 'Copy code' }));
      await waitFor(() => expect(copied).toBe(line.repeat(21)));
    } finally {
      navigator.clipboard.writeText = original;
    }
    await userEvent.click(canvas.getByRole('button', { name: 'Finish' }));
    expect(canvasElement.querySelector('code')?.textContent).toBe(line.repeat(21).trimEnd());
  },
};

export const EveryFrameOptOut: StoryObj = {
  render: () => <Harness interval={0} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Reset count' }));
    for (let i = 0; i < 20; i++) await userEvent.click(canvas.getByRole('button', { name: 'Append' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Report count' }));
    expect(Number(canvas.getByLabelText('Highlight calls').textContent)).toBeGreaterThanOrEqual(20);
    expect(canvasElement.querySelector('code')?.textContent).toBe(line.repeat(21).trimEnd());
  },
};

export const TrailingFrameAndInvalidation: StoryObj = {
  render: () => <Harness interval={50} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Append' }));
    await waitFor(() => expect(canvasElement.querySelector('code')?.textContent).toBe(line.repeat(2).trimEnd()));
    await userEvent.click(canvas.getByRole('button', { name: 'Switch language' }));
    expect(canvasElement.querySelector('code')?.classList.contains('python')).toBe(true);
    await userEvent.click(canvas.getByRole('button', { name: 'Switch adapter' }));
    expect(canvasElement.querySelector('code')?.getAttribute('data-adapter')).toBe('replacement');
    expect(canvasElement.querySelector('code')?.textContent).toBe(line.repeat(2).trimEnd());
  },
};
