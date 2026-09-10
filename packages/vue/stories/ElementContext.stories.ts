import { defineComponent, h, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown, { type MarkdownElementContext } from '../src';
import { LINKS } from '@ai-markdown/storybook-kit/common/corpus';

const meta: Meta = {
  title: 'Customization/Element Context',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Element slots receive node, properties, children, streaming and metadata. Mapped Vue components receive normalized element attributes plus node, streaming and metadata as props, and rendered children through the default slot. An element slot takes precedence over a component mapping for the same tag. Compare React Customization/Extending/Contexts & Hooks; Vue uses props and scoped slots rather than React context hooks.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<{ metadata?: string; streaming?: boolean }>;
const ContextLink = defineComponent({
  inheritAttrs: false,
  props: ['node', 'streaming', 'metadata'],
  setup:
    (props, { attrs, slots }) =>
    () =>
      h(
        'a',
        {
          ...attrs,
          'data-context-owner': 'component',
          'data-node-tag': props.node.tagName,
          'data-streaming': String(props.streaming),
          title: String(props.metadata),
        },
        slots.default?.()
      ),
});

export const ReactiveContext: Story = {
  args: { metadata: 'Corpus links', streaming: true },
  argTypes: { metadata: { control: 'text' }, streaming: { control: 'boolean' } },
  parameters: {
    docs: {
      description: {
        story:
          'The two renderers share the same corpus source and metadata. The first uses a mapped component with inheritAttrs disabled and explicit attribute forwarding. The second forwards slot properties and children. Change metadata or streaming in Controls to inspect both contexts without reparsing new text. Update context temporarily overrides both values; Reset context resumes the current Controls values. The automatic interaction check restores this Controls-driven state before finishing.',
      },
    },
  },
  render: (args) => ({
    setup() {
      const updated = ref(false);
      return () => {
        const metadata = updated.value ? 'Updated context' : args.metadata;
        const streaming = updated.value ? false : args.streaming;
        return h('section', [
          h(
            'button',
            {
              onClick: () => {
                updated.value = !updated.value;
              },
            },
            updated.value ? 'Reset context' : 'Update context'
          ),
          h('h3', 'Component mapping'),
          h(AIMarkdown, { content: LINKS, metadata, streaming, components: { a: ContextLink } }),
          h('h3', 'Scoped slot'),
          h(
            AIMarkdown,
            { content: LINKS, metadata, streaming },
            {
              a: (context: MarkdownElementContext) =>
                h(
                  'a',
                  {
                    ...context.properties,
                    'data-context-owner': 'slot',
                    'data-node-tag': context.node.tagName,
                    'data-streaming': String(context.streaming),
                    title: String(context.metadata),
                  },
                  context.children
                ),
            }
          ),
        ]);
      };
    },
  }),
  play: async ({ canvasElement }) => {
    for (const owner of ['component', 'slot']) {
      await waitFor(() =>
        expect(canvasElement.querySelector(`[data-context-owner="${owner}"]`)).toHaveAttribute('title', 'Corpus links')
      );
      const link = canvasElement.querySelector(`[data-context-owner="${owner}"]`)!;
      expect(link).toHaveAttribute('data-node-tag', 'a');
      expect(link).toHaveAttribute('data-streaming', 'true');
      expect(link.getAttribute('href')).toBeTruthy();
      expect(link.textContent?.length).toBeGreaterThan(0);
    }
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Update context' }));
    await waitFor(() => {
      for (const owner of ['component', 'slot']) {
        const links = canvasElement.querySelectorAll(`[data-context-owner="${owner}"]`);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(link).toHaveAttribute('title', 'Updated context');
          expect(link).toHaveAttribute('data-streaming', 'false');
        }
      }
    });
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Reset context' }));
    await waitFor(() => {
      for (const owner of ['component', 'slot']) {
        const link = canvasElement.querySelector(`[data-context-owner="${owner}"]`);
        expect(link).toHaveAttribute('title', 'Corpus links');
        expect(link).toHaveAttribute('data-streaming', 'true');
      }
    });
  },
};

export const SlotPrecedence: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'With both components.a and an a slot present, the slot renders the link. Remove the slot to fall back to the mapped component, then restore it. Keep forwarding properties and children so hrefs and link labels survive either route.',
      },
    },
  },
  render: () => ({
    setup() {
      const slotEnabled = ref(true);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                slotEnabled.value = !slotEnabled.value;
              },
            },
            slotEnabled.value ? 'Remove link slot' : 'Restore link slot'
          ),
          h(
            AIMarkdown,
            { content: LINKS, components: { a: ContextLink } },
            slotEnabled.value
              ? {
                  a: ({ properties, children }: MarkdownElementContext) =>
                    h('a', { ...properties, 'data-context-owner': 'slot' }, children),
                }
              : {}
          ),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('[data-context-owner="slot"]')).not.toBeNull());
    expect(canvasElement.querySelector('[data-context-owner="component"]')).toBeNull();
    const href = canvasElement.querySelector('[data-context-owner="slot"]')!.getAttribute('href');
    await userEvent.click(canvas.getByRole('button', { name: 'Remove link slot' }));
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-context-owner="component"]')).toHaveAttribute('href', href)
    );
    expect(canvasElement.querySelector('[data-context-owner="slot"]')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Restore link slot' }));
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-context-owner="slot"]')).toHaveAttribute('href', href)
    );
    expect(canvasElement.querySelector('[data-context-owner="component"]')).toBeNull();
  },
};
