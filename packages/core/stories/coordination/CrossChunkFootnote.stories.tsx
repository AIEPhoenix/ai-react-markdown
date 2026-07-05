import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';
import { AIMarkdownDocuments } from '../../src/components/AIMarkdownDocuments';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Coordination/Cross-Chunk Footnotes',
  parameters: {
    docs: {
      description: {
        component:
          'When one logical document is split across multiple `<AIMarkdown>` instances (chunked / ' +
          'streamed rendering), wrap them in `<AIMarkdownDocuments>` and give every chunk the same ' +
          '`documentId`. A shared registry then coordinates footnotes and reference definitions ' +
          'across chunks: refs resolve to defs that live in a *later* chunk, global footnote ' +
          'numbering stays consistent, backrefs are injected, and the aggregate footnote footer ' +
          'renders only after the last chunk. Different `documentId`s stay fully isolated — same ' +
          'labels in two documents never cross-link.',
      },
    },
  },
};

export default meta;

/** Ref in chunk 1, definition arrives in chunk 2 — the footnote still resolves. */
export const TwoChunks: CoreStory = {
  render: () => (
    <AIMarkdownDocuments>
      <ThemedAIMarkdown content="See [^x] for details." documentId="msg-1" />
      <ThemedAIMarkdown content={'More text continues.\n\n[^x]: detailed footnote content.'} documentId="msg-1" />
    </AIMarkdownDocuments>
  ),
};

/** A definition with no ref anywhere is still rendered (Direction A: preserve orphans). */
export const OrphanDef: CoreStory = {
  render: () => <ThemedAIMarkdown content={'Body text.\n\n[^x]: orphan note still rendered (Direction A).'} />,
};

/**
 * 5-chunk scenario covering every coordination feature in one document:
 *   - footnote refs scattered across chunks 1-3, defs in chunks 4-5
 *   - multi-ref to the same label ([^markdown] in chunks 1 and 2) → global
 *     numbering stays consistent (1, 2 — not 1, 3)
 *   - link reference ([docs] full form in chunk 1, def in chunk 4)
 *   - image reference ([arch-img] in chunk 2, def in chunk 5)
 *   - link reference ([api] full form in chunk 3, def in chunk 5)
 *   - backref injection should fire on chunks 4 and 5 for each of their
 *     local defs that have cross-chunk refs.
 */
export const FiveChunksScattered: CoreStory = {
  render: () => (
    <AIMarkdownDocuments>
      <ThemedAIMarkdown
        documentId="msg-2"
        content={[
          '# Introduction',
          '',
          'The system uses [^markdown] for content rendering and [^streaming] for partial',
          'updates. See the [reference docs][docs] for more.',
        ].join('\n')}
      />
      <ThemedAIMarkdown
        documentId="msg-2"
        content={[
          '## Architecture',
          '',
          'Components are composed [^markdown] hierarchically. Below is the architecture',
          'diagram:',
          '',
          '![Architecture diagram][arch-img]',
        ].join('\n')}
      />
      <ThemedAIMarkdown
        documentId="msg-2"
        content={[
          '## Usage example',
          '',
          'The [`AIMarkdown`][api] component accepts these props. Refer back to',
          '[^streaming] for related concepts.',
        ].join('\n')}
      />
      <ThemedAIMarkdown
        documentId="msg-2"
        content={[
          '[^markdown]: GitHub-flavored Markdown spec, plus a few extensions for AI',
          '    rendering scenarios.',
          '',
          '[docs]: https://example.com/docs "Project documentation"',
        ].join('\n')}
      />
      <ThemedAIMarkdown
        documentId="msg-2"
        content={[
          '[^streaming]: Token-by-token streaming support for LLM outputs.',
          '',
          '[arch-img]: https://fastly.picsum.photos/id/337/200/300.jpg?hmac=0CnfGB9OuB4D8IneXqgjPMaGgLSHBKRjSkl_ITBmDxQ "Architecture overview"',
          '',
          '[api]: https://example.com/api',
        ].join('\n')}
      />
    </AIMarkdownDocuments>
  ),
};

// ─── Stress: 30 chunks, single document ──────────────────────────────────────
//
// One document split into exactly 30 streaming chunks. Mix of paragraph,
// heading, list, code, table, math, raw HTML, footnote refs/defs, link defs,
// and image refs scattered across chunks. Verifies:
//   - aggregate footer renders only at chunk 30
//   - per-chunk fingerprint cache stays stable as chunks mount in order
//   - phantom-def injection covers chunks that ref labels defined later
//   - multi-ref to the same label keeps global numbering consistent
//
// Label set: footnote labels `note-1`..`note-6`, link labels `ref-1`..`ref-4`,
// image label `img-1`. Some labels are referenced multiple times.

function buildThirtyChunkSingleDoc(): string[] {
  // Exactly 30 chunks. Each entry is the full markdown for one chunk; chunks
  // may contain multiple paragraphs separated by `\n\n` internally.
  return [
    // 1
    '# A Long Streaming Response\n\nBroken into 30 short chunks to exercise per-chunk coordination.',
    // 2
    'Section 1 introduces the concept of streaming with [^note-1] embedded references.',
    // 3
    '## Architecture\n\nSee the [overview docs][ref-1] for the high-level shape.',
    // 4
    'Each chunk is parsed independently. Refs to [^note-2] inside a chunk that has no local def get phantom-injected.',
    // 5
    '## Use cases\n\n1. **Token streaming** — chunks arrive over time and mount in order.\n2. **Stable IDs** — `useId` gives each chunk a deterministic React key.\n3. **Coordinated footers** — only the last chunk renders the aggregate.',
    // 6
    'When a model emits [^note-3] in the middle of streaming, the renderer handles it gracefully.',
    // 7
    '## Implementation notes\n\nThe [API reference][ref-2] covers the full surface.',
    // 8
    'Internally we rely on a few invariants:\n\n- Each chunk subscribes to the registry via `useSyncExternalStore`.\n- Contributions are guarded by a fingerprint to avoid re-entry.\n- Phantom defs carry a sentinel URL so the registry can ignore them.',
    // 9
    'The [glossary][ref-3] disambiguates terms used here.',
    // 10
    'Concept: a *block* is one top-level hast element. Block-level memoization keys by `(raw, occurrence, ctx, position)`.',
    // 11
    'Concept: a *fingerprint* is a stable string capturing the registry slice a block depends on.',
    // 12
    'See [^note-4] for a deeper discussion of cache invariants.',
    // 13
    'Another paragraph that does not reference anything in particular. Just prose for bulk.',
    // 14
    'And another. Streaming responses often look like this — many short paragraphs in sequence.',
    // 15
    '## Edge cases',
    // 16
    'Edge case A: raw HTML — <span>inline span</span>.',
    // 17
    'Edge case B: code block:\n\n```ts\nexport function f(x: number) {\n  return x + 1;\n}\n```',
    // 18
    'Edge case C: GFM tables:\n\n| col A | col B |\n| ----- | ----- |\n| 1     | 2     |\n| 3     | 4     |',
    // 19
    'Edge case D: math: $$\\sum_{i=0}^{n} i = \\frac{n(n+1)}{2}$$',
    // 20
    '## Wrap up',
    // 21
    'Multiple refs to the same label sanity-check global numbering: [^note-1] and [^note-3] appear in two places each.',
    // 22
    'And one image reference for completeness: ![lazy preview][img-1]',
    // 23
    'See [^note-5] and the [conclusion][ref-4] for the summary.',
    // 24
    'Final remark before the def chunks: [^note-6] is intentionally only ever referenced once.',
    // 25
    '[^note-1]: First footnote — referenced multiple times across the doc.\n\n[^note-2]: Second footnote — referenced once.',
    // 26
    '[^note-3]: Third footnote — referenced twice including at the wrap-up.\n\n[^note-4]: Fourth footnote — discusses cache invariants and TAINT semantics.',
    // 27
    '[^note-5]: Fifth footnote — covers the wrap-up case.\n\n[^note-6]: Sixth footnote — singleton ref, included for coverage.',
    // 28
    '[ref-1]: https://example.com/docs "Overview documentation"\n\n[ref-2]: https://example.com/api "API reference"',
    // 29
    '[ref-3]: https://example.com/glossary\n\n[ref-4]: https://example.com/conclusion',
    // 30
    '[img-1]: https://fastly.picsum.photos/id/100/200/300.jpg?hmac=MeTp97vw7VNDswRcCqUFkGNC8ILDvNfI4MRoHFyGcQ8',
  ];
}

/** Stress: one document in exactly 30 chunks — footer only after the last one. */
export const ThirtyChunksSingleDoc: CoreStory = {
  render: () => {
    const chunks = buildThirtyChunkSingleDoc();
    // dev-only sanity assertion — keep the chunk count truthful in the title.
    if (chunks.length !== 30) {
      throw new Error(`ThirtyChunksSingleDoc expected 30 chunks, got ${chunks.length}`);
    }
    return (
      <AIMarkdownDocuments>
        {chunks.map((c, i) => (
          <ThemedAIMarkdown key={i} content={c} documentId="msg-stress-30" />
        ))}
      </AIMarkdownDocuments>
    );
  },
};

// ─── Stress: 60 chunks, three documents ──────────────────────────────────────
//
// Three independent documents (msg-stress-A/B/C), 20 chunks each, 60 total.
// Verifies:
//   - per-documentId registry isolation (each doc has its own clobberPrefix +
//     footnote namespace; identifiers `a`/`b`/`c` overlap across docs without
//     clobbering)
//   - aggregate footer appears at the end of each document's last chunk
//   - cross-document refs never resolve to a different document's defs
//
// Each document uses the same labels (`a`, `b`, `c`) intentionally so any
// leak across registries would show up as a wrong number / wrong link / wrong
// def body.

function buildDocChunks(tag: string): string[] {
  // Exactly 20 chunks per document. Chunks 1-17 are body content, 18-20 are defs.
  const body: string[] = [
    `# Document ${tag}`,
    `First chunk of ${tag}. Intro paragraph with a ref [^a].`,
    `Section overview for ${tag}. References [^b] and the [glossary][site].`,
    `Paragraph 4 of ${tag}. Plain prose, no refs.`,
    `Paragraph 5 of ${tag}. A list:\n\n- alpha\n- beta\n- gamma`,
    `Section 6 of ${tag} references [^b] again to test ref-count > 1.`,
    `Paragraph 7 of ${tag}. Some \`inline code\` and a back-ref to [^a].`,
    `## Subsection in ${tag}\n\nA shortish heading break.`,
    `Paragraph 9 of ${tag}. Plain prose, no refs.`,
    `Paragraph 10 of ${tag}. Plain prose, no refs.`,
    `Paragraph 11 of ${tag} references the [glossary][site] a second time.`,
    `Paragraph 12 of ${tag}. Plain prose, no refs.`,
    `Paragraph 13 of ${tag}. Plain prose, no refs.`,
    `Paragraph 14 of ${tag}. Plain prose, no refs.`,
    `Paragraph 15 of ${tag}. A code block:\n\n\`\`\`\nhello ${tag}\n\`\`\``,
    `Paragraph 16 of ${tag}. Plain prose, no refs.`,
    `Final body paragraph in ${tag}, with a last ref [^c].`,
  ];
  const defs: string[] = [
    `[^a]: Footnote A in ${tag}.`,
    `[^b]: Footnote B in ${tag}.`,
    `[^c]: Footnote C in ${tag}.\n\n[site]: https://example.com/${tag.toLowerCase()}/glossary "${tag} glossary"`,
  ];
  const all = [...body, ...defs];
  if (all.length !== 20) {
    throw new Error(`buildDocChunks(${tag}) produced ${all.length} chunks, expected 20`);
  }
  return all;
}

/** Stress: three interleaved documents sharing labels — registries must not leak. */
export const SixtyChunksThreeDocs: CoreStory = {
  render: () => {
    const a = buildDocChunks('A');
    const b = buildDocChunks('B');
    const c = buildDocChunks('C');
    return (
      <AIMarkdownDocuments>
        {a.map((ch, i) => (
          <ThemedAIMarkdown key={`a-${i}`} content={ch} documentId="msg-stress-A" />
        ))}
        {b.map((ch, i) => (
          <ThemedAIMarkdown key={`b-${i}`} content={ch} documentId="msg-stress-B" />
        ))}
        {c.map((ch, i) => (
          <ThemedAIMarkdown key={`c-${i}`} content={ch} documentId="msg-stress-C" />
        ))}
      </AIMarkdownDocuments>
    );
  },
};
