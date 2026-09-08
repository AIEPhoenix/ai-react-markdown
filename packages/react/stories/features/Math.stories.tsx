import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { WithScheme } from '../_shared/colorScheme';
import { baseCoreMeta, type CoreMeta, type CoreStory } from '../_shared/meta';
import { docsLink } from '../_shared/docsLinks';
import { StreamingReplay, ThemedReplayButton } from '../_shared/streaming';
import { MATH_DOC } from '../_shared/fixtures';
import { getStreamingTheme } from '../streaming/theme';

/**
 * TeX math, inline and in display blocks, typeset by KaTeX.
 */
const meta: CoreMeta = {
  ...baseCoreMeta,
  title: 'Core/Features/Math',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'Math is always on. `$$…$$` produces a centered display block and `$…$`',
          'produces an inline formula; both are typeset by KaTeX, which emits MathML',
          'for assistive technology alongside the visual markup.',
          '',
          'One integration requirement: **your application must load the KaTeX',
          "stylesheet** (`import 'katex/dist/katex.min.css'`). Without it the formulas",
          'still render, but as a column of unpositioned glyphs. These stories import',
          'it at the top of the file, which is exactly what a consuming app does.',
          '',
          'The single-dollar form is worth a note. The parser is configured with',
          '`singleDollarTextMath: false`, so a lone `$` in prose stays a currency sign;',
          'a content preprocessor rewrites genuine `$…$` spans into the double-dollar',
          `form before parsing. See ${docsLink('content-preprocessors', 'content preprocessors')}`,
          'for how that stage works and how to add your own.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Inline formulas flowing with the prose, then display blocks: a definite
 * integral, an `aligned` environment, a matrix, and an infinite sum. The
 * display forms are where a missing KaTeX stylesheet shows up first — if the
 * matrix looks like a vertical list of numbers, the CSS never loaded.
 */
export const InlineAndBlock: CoreStory = {
  args: {
    content: MATH_DOC,
  },
};

/**
 * The same document streamed character by character. The point is what you
 * do **not** see: a `$$` block that has only been half delivered renders as
 * nothing at all rather than flashing its raw TeX source, so the reader never
 * watches `\begin{aligned}` appear as literal text and then vanish. The block
 * materializes fully typeset the moment its closing `$$` arrives.
 *
 * Press **Restart** to replay; the cadence is seeded and repeats exactly.
 */
export const StreamingMath: CoreStory = {
  args: {
    content: MATH_DOC,
  },
  parameters: {
    // Streaming stories stay report-only. axe samples whatever is on screen at
    // one arbitrary instant of the stream, and a heading caught halfway
    // through being typed is a legitimately empty `<h1>` — `empty-heading`
    // then fires or does not fire depending on machine speed.
    a11y: { test: 'todo' },
    controls: { include: ['content'] },
  },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={args.content ?? ''}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdown {...args} content={content} streaming={streaming} colorScheme={colorScheme} />
          )}
        </StreamingReplay>
      )}
    </WithScheme>
  ),
};
