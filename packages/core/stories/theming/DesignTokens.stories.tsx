import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';

const SAMPLE = `# Retheme with CSS variables

No JavaScript needed — just override the tokens you care about.

A paragraph with a [link](https://example.com), ==a highlight==, and \`inline code\`.

> A blockquote, to show border and spacing tokens.

1. Ordered item one
2. Ordered item two

\`\`\`ts
const themed = true;
\`\`\``;

/**
 * Inject a scoped stylesheet that overrides design tokens at higher specificity
 * than the library's own `.aim-typography-root.default` rule. The library
 * documents overriding "at that selector or a more specific one" — prefixing
 * with our scope class is exactly that.
 */
function TokenScope({
  scope,
  tokens,
  children,
}: {
  scope: string;
  tokens: Record<string, string>;
  children: React.ReactNode;
}) {
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  const css = `.${scope} .aim-typography-root.default {\n${body}\n}`;
  return (
    <div className={scope}>
      <style>{css}</style>
      {children}
    </div>
  );
}

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Theming/Design Tokens',
  parameters: {
    docs: {
      description: {
        component:
          'The `default` variant is driven entirely by CSS custom properties scoped to ' +
          '`.aim-typography-root.default`. Override the tokens you want in your own stylesheet ' +
          '(at that selector or a more specific one) and the library picks them up — **full ' +
          'retheme, zero JavaScript**. Each story below injects a scoped `<style>` overriding a ' +
          'few tokens; everything else inherits the defaults.',
      },
    },
  },
  args: { content: SAMPLE },
};

export default meta;

function renderWithTokens(scope: string, tokens: Record<string, string>): CoreStory['render'] {
  return (args) => (
    <TokenScope scope={scope} tokens={tokens}>
      <ThemedAIMarkdown {...args} />
    </TokenScope>
  );
}

/** A brand palette: accent color, highlight color, lighter heading weight, rounder corners. */
export const BrandPalette: CoreStory = {
  render: renderWithTokens('aim-scope-brand', {
    '--aim-color-anchor': '#7048e8',
    '--aim-color-mark-bg': '#f3e8ff',
    '--aim-color-mark-text': '#5f3dc4',
    '--aim-font-weight-strong': '600',
    '--aim-radius-sm': '0.5rem',
  }),
};

/** Tighter spacing without shrinking the text — the kind of non-proportional tweak tokens unlock. */
export const CompactSpacing: CoreStory = {
  render: renderWithTokens('aim-scope-compact', {
    '--aim-spacing-md': 'calc(var(--aim-font-size-root) * 0.55)',
    '--aim-spacing-lg': 'calc(var(--aim-font-size-root) * 0.7)',
    '--aim-spacing-xl': 'calc(var(--aim-font-size-root) * 0.85)',
    '--aim-line-height': '1.4',
  }),
};

/** A bigger, serif display scale for headings only — body text is untouched. */
export const DisplayHeadings: CoreStory = {
  render: renderWithTokens('aim-scope-display', {
    '--aim-font-family-headings': 'Georgia, "Times New Roman", serif',
    '--aim-h1-font-size': 'calc(var(--aim-font-size-root) * 2.6)',
    '--aim-h1-line-height': '1.15',
  }),
};
