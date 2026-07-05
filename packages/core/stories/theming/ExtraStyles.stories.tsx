import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown, useColorScheme } from '../_shared/coreMeta';
import type { AIMarkdownExtraStylesComponent } from '../../src/index';

const SAMPLE = `## Getting started

Install the package and render your first message.

## Configuration

Tweak the pipeline through the \`config\` prop.

> Everything is opt-in — the defaults cover the common chat case.

## Going further

Custom components, typography, and this very \`ExtraStyles\` slot.`;

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Theming/Extra Styles',
  parameters: {
    docs: {
      description: {
        component:
          '`ExtraStyles` is an optional wrapper component rendered **inside** the typography ' +
          'wrapper but **outside** the rendered markdown: `<Typography><ExtraStyles>…markdown…' +
          '</ExtraStyles></Typography>`. Use it for CSS scope or theme providers that should be ' +
          'co-located with the rendered markdown while staying independent of typography theming ' +
          '— the Mantine package uses exactly this slot (`MantineAIMDefaultExtraStyles`) to scope ' +
          'its `@mantine` CSS-variable overrides. It receives only `children`. **Footgun:** ' +
          'define the component at module scope. An inline arrow ' +
          '(`ExtraStyles={({ children }) => …}`) creates a new component *type* on every parent ' +
          'render, so React unmounts and remounts the entire markdown subtree each time.',
      },
    },
  },
  args: { content: SAMPLE },
};

export default meta;

/**
 * A scoped stylesheet co-located with the markdown: CSS counters auto-number the `h2`s —
 * behavior no design token expresses. The scope class keeps the rules from leaking to the
 * rest of the page.
 */
const NumberedHeadings: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="aim-extra-numbered">
    <style>{`
      .aim-extra-numbered { counter-reset: aim-h2; }
      .aim-extra-numbered h2 { counter-increment: aim-h2; }
      .aim-extra-numbered h2::before { content: counter(aim-h2) ". "; opacity: 0.55; }
    `}</style>
    {children}
  </div>
);

/**
 * Makes the slot's position visible: a labeled frame around exactly what `ExtraStyles`
 * wraps. The frame sits inside the typography wrapper (tokens, font-size, and color scheme
 * still apply) and outside the markdown content. A wrapper component may use hooks — here it
 * reads the story's live color scheme for the frame chrome.
 */
const VisibleSlotFrame: AIMarkdownExtraStylesComponent = ({ children }) => {
  const colorScheme = useColorScheme();
  const border = colorScheme === 'dark' ? '#5c636a' : '#adb5bd';
  return (
    <div style={{ border: `1px dashed ${border}`, borderRadius: 8, padding: '4px 16px', position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          top: -9,
          left: 12,
          padding: '0 6px',
          font: '11px ui-monospace, monospace',
          background: colorScheme === 'dark' ? 'rgb(36, 36, 36)' : '#fff',
          color: border,
        }}
      >
        ExtraStyles wrapper
      </span>
      {children}
    </div>
  );
};

/** Scoped CSS that auto-numbers the headings — styling a token surface can't express. */
export const ScopedStylesheet: CoreStory = {
  render: (args) => <ThemedAIMarkdown {...args} ExtraStyles={NumberedHeadings} />,
};

/** A dashed, labeled frame showing exactly what the slot wraps — and that hooks work inside it. */
export const SlotPositionVisualized: CoreStory = {
  render: (args) => <ThemedAIMarkdown {...args} ExtraStyles={VisibleSlotFrame} />,
};
