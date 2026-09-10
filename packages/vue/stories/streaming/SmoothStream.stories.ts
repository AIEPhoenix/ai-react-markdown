import { EMPHASIS, QUOTES, STREAMING_SAMPLE } from '@ai-markdown/storybook-kit/common/corpus';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import AIMarkdown, { AIMarkdownSmoothStream, useSmoothStream, type SmoothStreamPacing } from '../../src';
import { play, replay } from '../_shared/replayStories';
const meta: Meta = {
  title: 'Streaming/Smooth Streaming',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Smooth reveal uses the same engine pacing contract as React. Producer completion drains the reveal; flush releases confirmed buffered text while preserving a tentative final grapheme. Vue exposes the controller through composables and component refs.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<{ content?: string; streaming?: boolean; pacing?: SmoothStreamPacing }>;
export const SmoothReveal: Story = { render: () => replay(true), play };
export const ComposableFlush: Story = {
  args: { pacing: 'balanced' },
  argTypes: { pacing: { control: 'select', options: ['balanced', 'responsive', 'smooth'] } },
  parameters: {
    docs: {
      description: {
        story:
          'Call useSmoothStream during setup with a getter over reactive inputs. Render its content and streaming refs, and call flush to reveal confirmed queued text without marking the producer complete. The final tentative grapheme stays buffered until another append or producer completion confirms it. Finish producer changes the input flag; Replace source demonstrates a new completed answer. Pacing can be changed in Controls.',
      },
    },
  },
  render: (args) => ({
    setup() {
      const source = ref('');
      const producing = ref(false);
      const smooth = useSmoothStream(() => ({
        content: source.value,
        streaming: producing.value,
        pacing: args.pacing,
      }));
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                producing.value = true;
                source.value = STREAMING_SAMPLE;
              },
            },
            'Receive corpus'
          ),
          h('button', { onClick: smooth.flush }, 'Flush visible text'),
          h(
            'button',
            {
              onClick: () => {
                producing.value = false;
              },
            },
            'Finish producer'
          ),
          h(
            'button',
            {
              onClick: () => {
                producing.value = false;
                source.value = QUOTES;
              },
            },
            'Replace source'
          ),
          h('output', { 'data-producer': '' }, producing.value ? 'Producer active' : 'Producer finished'),
          h('output', { 'data-reveal': '' }, `${smooth.content.value.length}/${source.value.length}`),
          h(AIMarkdown, { content: smooth.content.value, streaming: smooth.streaming.value }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Receive corpus' }));
    await waitFor(() => expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Flush visible text' }));
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-reveal]')).toHaveTextContent(
        `${Array.from(new Intl.Segmenter().segment(STREAMING_SAMPLE)).at(-1)!.index}/${STREAMING_SAMPLE.length}`
      )
    );
    expect(canvasElement.querySelector('[data-producer]')).toHaveTextContent('Producer active');
    expect(canvasElement.querySelector('table')).not.toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Finish producer' }));
    await waitFor(() => expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull());
    expect(canvasElement.querySelector('[data-reveal]')).toHaveTextContent(
      `${STREAMING_SAMPLE.length}/${STREAMING_SAMPLE.length}`
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Replace source' }));
    await waitFor(() => expect(canvasElement.querySelector('blockquote')).not.toBeNull());
    expect(canvasElement.querySelector('table')).toBeNull();
  },
};
export const InitialSnapshot: Story = {
  args: { content: EMPHASIS, streaming: false, pacing: 'balanced' },
  argTypes: {
    content: { control: 'text' },
    streaming: { control: 'boolean' },
    pacing: { control: 'select', options: ['balanced', 'responsive', 'smooth'] },
  },
  parameters: {
    docs: {
      description: {
        story:
          'AIMarkdownSmoothStream renders nonempty initial content in full, including SSR and remounts. It animates subsequent updates while streaming; an existing answer is not replayed from zero. Edit content with streaming off to replace the completed snapshot, or enable streaming before appending text.',
      },
    },
  },
  render: (args) => ({
    setup: () => () =>
      h(AIMarkdownSmoothStream, { content: args.content ?? EMPHASIS, streaming: args.streaming, pacing: args.pacing }),
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('strong')).not.toBeNull());
    expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull();
  },
};
