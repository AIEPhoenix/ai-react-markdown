import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { PAGE_PALETTE } from '../_shared/colorScheme';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { Labeled, SideBySide } from '../_shared/layouts';
import { baseCoreMeta, type CoreMeta, type CoreStory } from '../_shared/meta';
import { docsLink } from '../_shared/docsLinks';
import { PROSE_SAMPLE } from '../_shared/fixtures';

/**
 * The two props that retheme the component without a stylesheet, and the
 * variant slot beside them.
 */
const meta: CoreMeta = {
  ...baseCoreMeta,
  title: 'Core/Theming/Font Size & Color Scheme',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    docs: {
      description: {
        component: [
          '`fontSize` accepts any CSS length (a bare number is read as pixels) and is',
          'written straight onto the typography root as `--aim-font-size-root`. Because',
          'the default variant defines every spacing, heading, and body size as a',
          'multiple of that anchor, one prop rescales the entire document rather than',
          'just its body text.',
          '',
          "`colorScheme` selects between the variant's two colour sets, `'light'` and",
          "`'dark'`. It is a plain prop, with no media query and no persistence behind",
          'it — the component renders the scheme it is told to render, and deciding which',
          'one that is stays with the application.',
          '',
          `Related: ${docsLink('design-tokens', 'design tokens')} for the properties both`,
          `props drive, and ${docsLink('custom-typography', 'custom typography')} for`,
          'replacing the wrapper outright.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * The same document at three sizes. Only `fontSize` differs between the
 * panels — the heading scale, the vertical rhythm, the code-span size, and
 * the blockquote inset all follow from it, because the default variant holds
 * no absolute lengths.
 *
 * The middle panel passes nothing, so it shows the built-in default of
 * `0.9375rem`.
 */
export const FontSizes: CoreStory = {
  parameters: {
    controls: { include: ['content'] },
  },
  args: {
    content: PROSE_SAMPLE,
  },
  render: (args) => (
    <div style={{ display: 'grid', gap: 32 }}>
      <Labeled label='fontSize="14px"'>
        <ThemedAIMarkdown content={args.content ?? ''} fontSize="14px" />
      </Labeled>
      <Labeled label="fontSize not passed — the 0.9375rem default">
        <ThemedAIMarkdown content={args.content ?? ''} />
      </Labeled>
      <Labeled label='fontSize="1.125rem"'>
        <ThemedAIMarkdown content={args.content ?? ''} fontSize="1.125rem" />
      </Labeled>
    </div>
  ),
};

/**
 * Both schemes at once, each panel painted with the page background its scheme
 * expects. This is the one story in the Core branch that deliberately ignores
 * the theme toolbar: the panels pass `colorScheme` as a literal, so switching
 * the toolbar changes the chrome around them and leaves the two renders alone.
 *
 * That difference is the thing worth understanding. Every other story wires
 * the prop to the toolbar through a React context, which is how a real
 * application behaves — the app owns the decision (from a user setting, from
 * `prefers-color-scheme`, from whatever else) and passes the answer down. The
 * component itself never reads the media query, so nothing here changes on its
 * own.
 *
 * Note also that the scheme controls colours only. The two panels use
 * identical spacing and identical type sizes.
 */
export const ColorSchemes: CoreStory = {
  parameters: {
    controls: { include: ['content'] },
  },
  args: {
    content: PROSE_SAMPLE,
  },
  render: (args) => {
    const panel = { borderRadius: 6, padding: 16 };
    return (
      <SideBySide
        leftLabel='colorScheme="light"'
        rightLabel='colorScheme="dark"'
        left={
          <div style={{ ...panel, background: '#ffffff', color: PAGE_PALETTE.light.text }}>
            <AIMarkdown content={args.content ?? ''} colorScheme="light" />
          </div>
        }
        right={
          <div style={{ ...panel, background: PAGE_PALETTE.dark.background, color: PAGE_PALETTE.dark.text }}>
            <AIMarkdown content={args.content ?? ''} colorScheme="dark" />
          </div>
        }
      />
    );
  },
};

/**
 * `variant` names the typography variant. The control lists exactly one
 * option, because `default` is the only variant the package ships — the
 * select is here so the prop is visible, not to suggest there is a second
 * theme to switch to.
 *
 * The value becomes a class on the typography root (`aim-typography-root
 * default light`), and the stylesheet scopes its token declarations to that
 * class. A consumer adding a variant therefore writes a stylesheet scoped to
 * `.aim-typography-root.mine`, imports it, and passes `variant="mine"` — the
 * package's own variants ship the same way, as CSS on the
 * `@ai-react-markdown/core/typography/*.css` subpath:
 *
 * ```ts
 * import '@ai-react-markdown/core/typography/default.css'; // or all.css
 * ```
 *
 * Replacing the wrapper element rather than its tokens is a different job —
 * that is the `Typography` prop, covered in the custom typography guide.
 */
export const Variant: CoreStory = {
  args: {
    content: PROSE_SAMPLE,
    variant: 'default',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default'],
      description: 'Typography variant name. `default` is the only one core ships.',
    },
  },
  parameters: {
    controls: { include: ['content', 'variant'] },
  },
};
