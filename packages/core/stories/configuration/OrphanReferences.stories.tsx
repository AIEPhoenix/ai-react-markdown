import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { SideBySide } from '../_shared/layouts';
import { baseCoreMeta, type CoreMeta, type CoreStory } from '../_shared/meta';
import { docsLink } from '../_shared/docsLinks';
import { ORPHAN_FOOTNOTE_CHUNK } from '../_shared/fixtures';

/**
 * What happens to a footnote definition whose reference has not arrived yet —
 * the half-written state every streamed answer passes through.
 */
const meta: CoreMeta = {
  ...baseCoreMeta,
  title: 'Core/Configuration/Orphan References',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'A footnote definition with no matching `[^label]` anywhere in the document is an',
          '**orphan**. The markdown-to-HTML converter drops orphans on the floor: a',
          'definition nobody cites is, to a batch renderer, dead text.',
          '',
          'That rule is wrong for streaming. A document being written a token at a time',
          'spends most of its life incomplete, and a document split across several',
          '`<AIMarkdown>` chunks is incomplete by construction — the sentence that cites a',
          'note may still be arriving, or may live in a sibling chunk that has not',
          'rendered. Left alone, the note would appear, vanish, and reappear as the stream',
          'progresses.',
          '',
          '`preserveOrphanReferences` (on by default) protects those definitions so they',
          'render even while nothing points at them. It is the one behavior switch on this',
          'list that **changes output** — `blockMemo` and `incrementalParse` are',
          'output-invariant optimizations, this one is a rendering policy.',
          '',
          'The override chain has three tiers, and the top one is unconditional: a',
          '`preserveOrphanReferences` on an `<AIMarkdownDocuments>` wrapper wins for every',
          "chunk beneath it, over each chunk's own prop, over the shipped default. Omitting",
          'it on the wrapper is not neutral — it reads as an explicit `true`.',
          '',
          `See ${docsLink('cross-chunk-coordination', 'cross-chunk coordination')} for the override chain and`,
          `${docsLink('architecture', 'the architecture guide')} for where the protection is applied in the pipeline.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * One chunk of an answer, frozen mid-stream: the `## Sources` block has landed
 * with two footnote definitions in it, and the paragraph that cites them is
 * still being written. Both panels render that exact document with
 * `streaming` set, and no timer runs — the state is pinned so the comparison
 * is the same every time you open the page.
 *
 * **Left, protection on (the default): both notes render** in a footnote
 * footer, without back-reference arrows. There is nothing to go back to yet;
 * the arrows appear once a reference exists.
 *
 * **Right, protection off: there is no footer at all.** The two definitions
 * were dropped during conversion, so the reader sees the heading, the
 * unfinished paragraph, and nothing else. Watch what that means across a live
 * stream: the notes would materialize only at the instant the citation is
 * typed, several seconds after the text they belong to.
 *
 * Turning the switch off is defensible for a *finished* document, where an
 * orphan really is an authoring mistake and hiding it is arguably the more
 * honest render. For anything streamed, leave it on.
 */
export const PausedStreamComparison: CoreStory = {
  args: { content: ORPHAN_FOOTNOTE_CHUNK },
  render: (args) => (
    <SideBySide
      leftLabel="preserveOrphanReferences (default)"
      rightLabel="preserveOrphanReferences={false}"
      left={<ThemedAIMarkdown content={args.content ?? ''} streaming preserveOrphanReferences />}
      right={<ThemedAIMarkdown content={args.content ?? ''} streaming preserveOrphanReferences={false} />}
    />
  ),
};
