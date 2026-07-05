import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, AIMarkdown } from '../_shared/coreMeta';

const SAMPLE = `# Heading scales too

Body copy at the base size, with a nested list:

- First item
- Second item

\`\`\`ts
const scaled = true;
\`\`\`

> Blockquotes, code, and headings all track the single \`fontSize\` prop.`;

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Theming/Font Size',
  parameters: {
    docs: {
      description: {
        component:
          'Every spacing, font-size, and heading token is defined as ' +
          '`calc(var(--aim-font-size-root) * k)`, and the core renderer injects ' +
          '`--aim-font-size-root` from the `fontSize` prop. So **one prop proportionally scales ' +
          'the entire output** — text, spacing, headings, and KaTeX. Accepts a CSS length string ' +
          'or a number (treated as px).',
      },
    },
  },
  args: { content: SAMPLE },
};

export default meta;

/** Edit the `fontSize` control to watch every dimension scale in lockstep. */
export const Interactive: CoreStory = {
  args: { fontSize: '0.9375rem' },
};

const SIZES = ['0.8125rem', '0.9375rem', '1.125rem'] as const;

/** Three fixed sizes side by side — small, default, large. */
export const Scales: CoreStory = {
  parameters: { docs: { description: { story: 'The same markdown at 13px, 15px, and 18px equivalents.' } } },
  render: (args) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      {SIZES.map((size) => (
        <div key={size} style={{ flex: '1 1 280px', minWidth: 240 }}>
          <div style={{ marginBottom: 8, fontFamily: 'monospace', opacity: 0.6 }}>fontSize={size}</div>
          <AIMarkdown {...args} fontSize={size} />
        </div>
      ))}
    </div>
  ),
};
