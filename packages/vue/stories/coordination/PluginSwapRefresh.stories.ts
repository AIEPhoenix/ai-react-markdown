import { DEFINITION_LIST_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import AIMarkdown, { defaultEnginePlugins } from '../../src';
const meta: Meta = {
  title: 'QA/Plugin Swap Refresh',
  tags: ['qa'],
  parameters: {
    docs: {
      description: {
        component:
          'Browser regression for toggling definition-list parsing on an already mounted Vue renderer. Public plugin selection examples live in Basics/Engine Plugins.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
export const DefinitionPluginSwitch: Story = {
  render: () => ({
    setup() {
      const enabled = ref(true);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                enabled.value = !enabled.value;
              },
            },
            'Toggle definitions'
          ),
          h(AIMarkdown, { content: DEFINITION_LIST_DOC, enginePlugins: enabled.value ? defaultEnginePlugins : [] }),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Toggle definitions' });
    await waitFor(() => expect(canvasElement.querySelector('dl dt')).not.toBeNull());
    await userEvent.click(button);
    await waitFor(() => expect(canvasElement.querySelector('dl')).toBeNull());
    expect(canvasElement.textContent).toContain(': A named CSS');
    await userEvent.click(button);
    await waitFor(() => expect(canvasElement.querySelector('dl dd')).not.toBeNull());
  },
};
