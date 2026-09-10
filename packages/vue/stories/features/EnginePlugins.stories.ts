import type { AIMarkdownProps } from '../../src';
import { DEFINITION_LIST_DOC, MARK_HIGHLIGHT_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import AIMarkdown, { defaultEnginePlugins, highlight } from '../../src';
const meta: Meta = {
  title: 'Basics/Engine Plugins',
  tags: ['autodocs'],
  component: AIMarkdown,
  render: (args) => ({ setup: () => () => h(AIMarkdown, { ...args, content: args.content ?? '' }) }),
  argTypes: { content: { control: 'text' } },
  parameters: {
    docs: {
      description: {
        component:
          'enginePlugins replaces the default list rather than extending it. Compare defaults, highlight-only and an empty selection on the same mounted renderer. The syntax fixtures match React Basics/Engine Plugins.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<Partial<AIMarkdownProps> & { selection?: 'defaults' | 'highlight only' | 'none' }>;
export const Highlight: Story = {
  args: { content: MARK_HIGHLIGHT_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('mark')).not.toBeNull());
  },
};
export const PluginsDisabled: Story = {
  args: { content: MARK_HIGHLIGHT_DOC, enginePlugins: [] },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('=='));
    expect(canvasElement.querySelector('mark')).toBeNull();
  },
};
export const ReactiveSelection: Story = {
  args: { selection: 'defaults' },
  argTypes: { selection: { control: 'select', options: ['defaults', 'highlight only', 'none'] } },
  parameters: {
    docs: {
      description: {
        story:
          'Choose a selection in Controls, or use the buttons to change it on the mounted component. Highlight-only retains mark elements but removes semantic definition lists. An empty array removes both plugins; Markdown text remains readable. Reset to Controls resumes the externally selected value.',
      },
    },
  },
  render: (args) => ({
    setup() {
      const override = ref<string>();
      return () => {
        const selection = override.value ?? args.selection;
        return h('section', [
          ...['defaults', 'highlight only', 'none'].map((value) =>
            h(
              'button',
              {
                onClick: () => {
                  override.value = value;
                },
              },
              value
            )
          ),
          h(
            'button',
            {
              onClick: () => {
                override.value = undefined;
              },
            },
            'Reset to Controls'
          ),
          h('output', selection),
          h(AIMarkdown, {
            content: `${MARK_HIGHLIGHT_DOC}\n\n${DEFINITION_LIST_DOC}`,
            enginePlugins:
              selection === 'defaults' ? defaultEnginePlugins : selection === 'highlight only' ? [highlight] : [],
          }),
        ]);
      };
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('dl')).not.toBeNull());
    expect(canvasElement.querySelector('mark')).not.toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'highlight only' }));
    await waitFor(() => expect(canvasElement.querySelector('dl')).toBeNull());
    expect(canvasElement.querySelector('mark')).not.toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'none' }));
    await waitFor(() => expect(canvasElement.querySelector('mark')).toBeNull());
    expect(canvasElement.textContent).toContain('==');
    await userEvent.click(canvas.getByRole('button', { name: 'Reset to Controls' }));
    await waitFor(() => expect(canvasElement.querySelector('dl')).not.toBeNull());
    expect(canvasElement.querySelector('mark')).not.toBeNull();
  },
};
