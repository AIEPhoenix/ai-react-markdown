import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';
import type { AIMarkdownTypographyComponent } from '../../src/index';

const SAMPLE = `## Wrapped by a custom Typography

The wrapper below adds a card frame and an ARIA landmark **around** the markdown
— while still merging the injected \`style\` so design tokens keep working.

- It must spread \`style\` onto its root element.
- It receives \`fontSize\`, \`variant\`, and \`colorScheme\`.

\`\`\`ts
const ok = true;
\`\`\``;

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Extending/Custom Typography',
  parameters: {
    docs: {
      description: {
        component:
          'The `Typography` prop swaps the wrapper element rendered around all markdown output. ' +
          'Reach for it when you need to change **structure** (a card, a Context provider, an ARIA ' +
          'landmark) — most pure-theming needs are better served by Design Tokens. The one ' +
          'non-negotiable rule: **merge the injected `style` onto your root element**, or ' +
          'descendant rules that read `var(--aim-font-size-root)` lose their anchor.',
      },
    },
  },
  args: { content: SAMPLE },
};

export default meta;

/** A card wrapper that also exposes the message as an ARIA `article` landmark. */
const CardTypography: AIMarkdownTypographyComponent = ({ children, fontSize, colorScheme, style }) => {
  const dark = colorScheme === 'dark';
  return (
    <article
      role="article"
      aria-label="Assistant message"
      style={{
        fontSize, // ergonomic flat prop
        ...style, // ← critical: carries --aim-font-size-root to descendants
        padding: '16px 20px',
        borderRadius: 12,
        border: `1px solid ${dark ? '#373a40' : '#e9ecef'}`,
        background: dark ? '#1f1f1f' : '#f8f9fa',
        boxShadow: dark ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      {children}
    </article>
  );
};

export const CardWrapper: CoreStory = {
  render: (args) => <ThemedAIMarkdown {...args} Typography={CardTypography} />,
};

/**
 * The footgun, shown deliberately: this wrapper forgets to spread `style`, so
 * `--aim-font-size-root` never reaches the content. The `fontSize` arg below is
 * large, yet token-driven dimensions fall back to their inherited defaults.
 * Compare with `CardWrapper`, which spreads `style` correctly.
 */
// Intentional anti-pattern for the docs: `style` is deliberately NOT spread.
const BrokenTypography: AIMarkdownTypographyComponent = ({ children, fontSize }) => (
  <div style={{ fontSize }}>{children}</div>
);

export const MissingStyleFootgun: CoreStory = {
  args: { fontSize: '1.5rem' },
  parameters: {
    docs: {
      description: {
        story:
          'Anti-pattern: `style` is not spread. Even at `fontSize="1.5rem"`, headings and spacing ' +
          'do not scale because the token anchor is missing.',
      },
    },
  },
  render: (args) => <ThemedAIMarkdown {...args} Typography={BrokenTypography} />,
};
