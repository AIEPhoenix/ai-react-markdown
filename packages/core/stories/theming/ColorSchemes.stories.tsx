import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, AIMarkdown } from '../_shared/coreMeta';

const SAMPLE = `## Color scheme demo

A paragraph with a [link](https://example.com), some \`inline code\`, and
==highlighted text== so you can compare accent colors.

> A blockquote picks up the dimmed border and background tokens.

| Token | Light | Dark |
| ----- | ----- | ---- |
| Anchor | blue | lighter blue |
| Border | grey | darker grey |

\`\`\`ts
const scheme: 'light' | 'dark' = 'light';
\`\`\``;

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Theming/Color Schemes',
  parameters: {
    docs: {
      description: {
        component:
          'The `colorScheme` prop (`"light"` | `"dark"`) switches which CSS token scope is ' +
          'active — `.aim-typography-root.light` vs `.aim-typography-root.dark`. No JS theme ' +
          'context, just a class. Use the toolbar **Theme** switch on the first story, or see ' +
          'both at once below.',
      },
    },
  },
  args: { content: SAMPLE },
};

export default meta;

/** Honors the toolbar Theme switch — flip it to see light ↔ dark. */
export const FollowToolbar: CoreStory = {};

const panelStyle = (dark: boolean): React.CSSProperties => ({
  flex: '1 1 320px',
  minWidth: 280,
  padding: 20,
  borderRadius: 10,
  border: `1px solid ${dark ? '#373a40' : '#dee2e6'}`,
  background: dark ? 'rgb(36, 36, 36)' : '#ffffff',
  color: dark ? '#c1c2c5' : '#1a1b1e',
});

/**
 * Both schemes rendered simultaneously and independently of the toolbar, so the
 * accent, border, and code-surface differences are directly comparable.
 */
export const SideBySide: CoreStory = {
  parameters: { docs: { description: { story: 'Two fixed instances — one `light`, one `dark`.' } } },
  render: (args) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <div style={panelStyle(false)}>
        <AIMarkdown {...args} colorScheme="light" />
      </div>
      <div style={panelStyle(true)}>
        <AIMarkdown {...args} colorScheme="dark" />
      </div>
    </div>
  ),
};
