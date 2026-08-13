import React, { memo } from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { type AIMarkdownExtraStylesComponent, type AIMarkdownTypographyProps } from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { SideBySide } from '../_shared/layouts';
import { baseCoreMeta, type CoreMeta, type CoreStory } from '../_shared/meta';
import { docsLink } from '../_shared/docsLinks';
import { PROSE_SAMPLE } from '../_shared/fixtures';

/**
 * The two slots that let you replace the library's presentation without
 * touching its rendering.
 */
const meta: CoreMeta = {
  ...baseCoreMeta,
  title: 'Core/Theming/Custom Typography & ExtraStyles',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content', 'fontSize'] },
    docs: {
      description: {
        component: [
          'Between the renderer and your markdown sit two component slots, and between',
          'them they own everything about how the output looks.',
          '',
          '`Typography` is the outermost wrapper. The default one renders a `<div>` with',
          '`aim-typography-root`, the variant name, and the color scheme as class names —',
          'which is what activates the `--aim-*` token declarations. **Replacing it takes',
          'the token surface with it**, because those tokens are declared on that element',
          'rather than on `:root`. That is a fair trade when you are re-theming from',
          "scratch (the Mantine package does exactly this, substituting Mantine's own",
          '`<Typography>`), and a trap when you only wanted to nudge one thing — for that,',
          'override the tokens instead and leave the slot alone.',
          '',
          '`ExtraStyles` is the inner wrapper, and it is the additive one. The default is a',
          'pass-through; a replacement can inject a `<style>` element, add a class, or wrap',
          'the content, all without disturbing the token root above it.',
          '',
          '```tsx',
          '<AIMarkdown content={md} Typography={SerifTypography} ExtraStyles={FancyQuotes} />',
          '```',
          '',
          'Both props go through the stability firewall as **component identities**, which',
          'is the one rule worth remembering: define them at module scope. An arrow',
          'function written inline in JSX is a new component type on every render, so React',
          'unmounts and remounts the entire document each time — the block-memo cache is',
          'discarded, scroll position is lost, and any state inside your slot resets.',
          'Development builds warn when they catch it.',
          '',
          `See ${docsLink('custom-typography', 'custom typography')} for the full slot contract, and`,
          `${docsLink('design-tokens', 'design tokens')} for the override path that keeps the default root.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * A replacement Typography: serif body, wider measure, no token classes.
 *
 * Module scope, `memo`'d, and it forwards `style` — the renderer writes
 * `--aim-font-size-root` into that object, so dropping it silently breaks the
 * `fontSize` prop for anything downstream that reads the token.
 */
const SerifTypography = memo(({ children, fontSize, style }: AIMarkdownTypographyProps) => (
  <div
    style={{
      fontFamily: 'Iowan Old Style, Palatino, Georgia, serif',
      fontSize,
      lineHeight: 1.7,
      maxWidth: '38em',
      width: '100%',
      ...style,
    }}
  >
    {children}
  </div>
));
SerifTypography.displayName = 'SerifTypography';

/**
 * The same document through the default typography and through a replacement.
 *
 * The right panel is not "the default plus a serif face" — it is a different
 * root element, so the `--aim-*` tokens are gone and with them every default
 * the variant stylesheet provided: heading scale, paragraph rhythm, blockquote
 * rule, table borders, code background. What is left is what the replacement
 * declares plus the browser's own defaults, which is why the two panels differ
 * in far more than the font.
 *
 * That is the honest cost of the slot. Take it when you are theming the whole
 * surface and have your own stylesheet to put in its place; the panels here
 * deliberately show the unstyled floor rather than a polished substitute, so
 * the size of the job is visible.
 *
 * `fontSize` keeps working across the swap, because `SerifTypography` applies
 * the prop and spreads the `style` object the renderer hands it.
 */
export const CustomTypography: CoreStory = {
  args: { content: PROSE_SAMPLE },
  render: (args) => (
    <SideBySide
      leftLabel="default Typography — token root intact"
      rightLabel="Typography={SerifTypography} — tokens gone with the root"
      left={<ThemedAIMarkdown content={args.content ?? ''} fontSize={args.fontSize} />}
      right={<ThemedAIMarkdown content={args.content ?? ''} fontSize={args.fontSize} Typography={SerifTypography} />}
    />
  ),
};

/**
 * An additive ExtraStyles: a scoped `<style>` element plus a class on the
 * wrapper, so the selectors cannot leak into the rest of the page.
 *
 * Scoping is the whole design of this slot. The style element is rendered
 * inside the wrapper, but CSS has no notion of "inside" — every selector here
 * is prefixed with the wrapper's class, and that prefix is the only thing
 * keeping `blockquote` from restyling every blockquote in the application.
 */
const FANCY_QUOTE_CSS = `
.aim-story-fancy blockquote {
  border-left: 3px solid var(--aim-color-anchor, #4c6ef5);
  background: color-mix(in srgb, var(--aim-color-anchor, #4c6ef5) 8%, transparent);
  border-radius: 0 6px 6px 0;
  font-style: italic;
  margin-inline: 0;
  padding: 8px 16px;
}
.aim-story-fancy blockquote p:last-child {
  margin-bottom: 0;
}
`;

const FancyQuotes: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="aim-story-fancy">
    <style>{FANCY_QUOTE_CSS}</style>
    {children}
  </div>
);

/**
 * Additive, not replacing: the right panel keeps the default typography root
 * and everything the token variant gives it, and only the blockquote changes.
 *
 * Note what the injected CSS is allowed to do. `var(--aim-color-anchor)` works
 * because the token root is still above this wrapper — the slot sits inside it,
 * so the tokens are in scope and the override tracks the color scheme for free.
 * Flip the toolbar and the quote's accent follows.
 *
 * This is the slot to reach for when you want to restyle a handful of elements.
 * It composes with token overrides rather than competing with them, and it
 * cannot accidentally strip a default the way replacing `Typography` does.
 */
export const ExtraStyles: CoreStory = {
  args: { content: PROSE_SAMPLE },
  render: (args) => (
    <SideBySide
      leftLabel="default ExtraStyles — pass-through"
      rightLabel="ExtraStyles={FancyQuotes} — scoped CSS, tokens intact"
      left={<ThemedAIMarkdown content={args.content ?? ''} fontSize={args.fontSize} />}
      right={<ThemedAIMarkdown content={args.content ?? ''} fontSize={args.fontSize} ExtraStyles={FancyQuotes} />}
    />
  ),
};
