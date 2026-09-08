import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { expect, waitFor } from 'storybook/test';
import { baseCoreMeta, type CoreMeta, type CoreStory } from '../_shared/meta';
import { docsLink } from '../_shared/docsLinks';
import { CJK_EMPHASIS_REGRESSION, CJK_MIXED_DOC, RTL_DOC } from '../_shared/fixtures';

/**
 * CJK and other non-Latin scripts, where the CommonMark emphasis rules and
 * real-world text disagree.
 */
const meta: CoreMeta = {
  ...baseCoreMeta,
  title: 'Core/Features/CJK & International Text',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'CommonMark decides whether `**` opens or closes emphasis by looking at the',
          'characters on either side — and it classifies CJK punctuation as ordinary',
          'text, not as punctuation. A model writing `**“会引起”**渲染错误` therefore',
          'produces a closing `**` that the spec says is not a closing delimiter, and',
          'the asterisks render literally.',
          '',
          'The engine corrects this class of failure. It also ships a second, optional',
          'rule for the same body of text: the `pangu` engine plugin inserts the',
          'missing space where a Latin word abuts a Han character or a kana. See',
          `${docsLink('cjk-typography', 'CJK typography')} for the full rule set and the`,
          'scripts each rule covers.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * The reported bug, one line per script. Every `**…**` pair here sits against
 * CJK punctuation — a full-width quote, a Japanese 。, a Korean parenthesis —
 * and every one of them must render as emphasis rather than as literal
 * asterisks. The last three repeat the set with `~~` strikethrough nested
 * inside, which is where the naive fix breaks.
 */
export const EmphasisPunctuationFix: CoreStory = {
  args: {
    content: CJK_EMPHASIS_REGRESSION,
  },
  // Regression guard shared with the Mantine wrapper's QA story: nine
  // emphasis pairs, three strikethroughs, and exactly one literal `**` (the
  // escaped `\*\*` in the first line).
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('strong')).toHaveLength(9));
    expect(canvasElement.querySelectorAll('del')).toHaveLength(3);
    expect((canvasElement.textContent?.match(/\*\*/g) ?? []).length).toBe(1);
  },
};

/**
 * Chinese, Japanese, and Korean prose in one document, plus a table with CJK
 * headers and cells.
 *
 * The Latin words are written without surrounding spaces, the way they arrive
 * from a model. What you see rendered is the `pangu` plugin's work: it opens
 * a space on each side of `React18`, `Vite`, `TypeScript`, and the rest. The
 * Korean section keeps its Latin runs tight against the Hangul, and that is
 * correct rather than a miss — the spacing rule is defined for Han characters
 * and kana, and Hangul is left alone.
 */
export const MixedCJK: CoreStory = {
  args: {
    content: CJK_MIXED_DOC,
  },
};

/**
 * A right-to-left document. Nothing in the markdown declares a direction: the
 * browser derives it from the characters themselves through the Unicode
 * bidirectional algorithm, so the paragraphs, the list markers, and the
 * blockquote rule all flip without a `dir` attribute anywhere.
 *
 * The third list item is the interesting one — an inline `code` span holding a
 * Latin word sits inside an Arabic sentence, and the neutral characters around
 * it have to resolve against the paragraph direction rather than against the
 * code span.
 */
export const RTL: CoreStory = {
  args: {
    content: RTL_DOC,
  },
};
