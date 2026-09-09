import { h, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import AIMarkdown, { defaultEnginePlugins } from '../src';
import { DEFINITION_LIST_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
const meta: Meta = { title: 'QA/Plugin Selection', tags: ['qa'] };
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
