/**
 * Byte-equivalence regression guard. Compares the output of
 * `<AIMarkdownContent>` (block-memo pipeline) against the output of the
 * vendored `<Markdown>` component using the same plugin chain.
 *
 * Block-level memoization MUST NOT change the rendered HTML byte-for-byte.
 * In particular:
 * - Top-level whitespace text inserted by `mdast-util-to-hast` between block
 *   elements (the `\n` between `<p>`s, the leading spaces of indented HTML)
 *   MUST be preserved by the `inline` items in the render plan.
 * - All extra-syntax and display-optimize plugins enabled by
 *   the default engine plugin set (mark highlight, definition list,
 *   super/subscript, remove-comments, smartypants, pangu) MUST run on the
 *   same content as the legacy bare `<Markdown>` reference.
 *
 * Scope of "byte-equivalence" in this suite:
 *
 * - **Standalone path** (the `describe('byte-equivalence ...')` blocks
 *   below): full `expect(renderNew).toBe(renderLegacy)` byte-for-byte
 *   equality. This is the strong contract.
 *
 * - **Cross-chunk path** (`describe('cross-chunk semantic equivalence')`):
 *   regex-strip and sort. Backref anchors are stripped, all remaining
 *   tags are dropped, and the resulting token sets are compared via
 *   set equality. This is **semantic** equivalence only — aggregate
 *   footer whitespace, attribute ordering, separator characters, and
 *   in-body markup divergence between the single-doc and chunked
 *   renderings are NOT enforced here. The chunked output is a
 *   deliberately weaker guarantee because the aggregate footer is
 *   synthesised separately from mdast-util-to-hast's footer emission.
 *   Do not assume the chunked output is byte-stable across releases.
 */

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from './markdown';
import AIMarkdownContent from './MarkdownContent';
import AIMarkdown from '../index';
import { AIMarkdownDocuments } from './AIMarkdownDocuments';
import AIMarkdownProvider from '../context';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkEmoji from 'remark-emoji';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkMath from 'remark-math';
import { remarkMark as remarkMarkHighlight } from '@ai-react-markdown/remark-mark-highlight';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import remarkRemoveComments from 'remark-remove-comments';
import remarkSmartypants from 'remark-smartypants';
import remarkPangu from 'remark-pangu';
import rehypeRaw from '@ai-markdown/rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import { sanitizeSchema } from '@ai-react-markdown/engine';
import { rehypeRebaseHashLinks } from '@ai-react-markdown/engine';
import { rehypeFooterAdorn } from '@ai-react-markdown/engine';
import { highlight, definitionList, removeComments, smartypants, pangu } from '@ai-react-markdown/engine';

type ExtraSyntaxName = 'highlight' | 'definitionList';
type DisplayOptimizeName = 'removeComments' | 'smartypants' | 'pangu';

interface PluginConfig {
  extras: ExtraSyntaxName[];
  display: DisplayOptimizeName[];
}

/** Maps names to the sealed catalog objects for the NEW-pipeline side only —
 *  the legacy mirror below keeps its own hand-rolled switch on names. */
const SEALED_BY_NAME = { highlight, definitionList, removeComments, smartypants, pangu } as const;

const ALL_EXTRAS: ExtraSyntaxName[] = ['highlight', 'definitionList'];
const ALL_DISPLAY: DisplayOptimizeName[] = ['removeComments', 'smartypants', 'pangu'];

// Deterministic document id used by both sides of the byte-equivalence test
// so the per-document clobber prefix matches and the two pipelines stay
// byte-identical. The legacy path mirrors the production prefix-construction
// shape (`encodeURIComponent(documentId) + '-user-content-'`) so this test
// catches any divergence between the two — even when the chosen id contains
// no reserved characters and the encode is a no-op.
const TEST_DOCUMENT_ID = 'be';
const TEST_CLOBBER_PREFIX = `${encodeURIComponent(TEST_DOCUMENT_ID)}-user-content-`;

function legacyPlugins(config: PluginConfig) {
  // Mirrors MarkdownContent.tsx's plugin assembly order EXACTLY so any
  // ordering bug shows up here.
  const extraSyntaxPlugins = config.extras.map((syntax) => {
    switch (syntax) {
      case 'highlight':
        return remarkMarkHighlight;
      case 'definitionList':
        return remarkDefinitionList;
    }
  });
  const displayPlugins = config.display.map((ability) => {
    switch (ability) {
      case 'removeComments':
        return remarkRemoveComments;
      case 'smartypants':
        return remarkSmartypants;
      case 'pangu':
        return remarkPangu;
    }
  });
  return {
    remarkPlugins: [
      remarkGfm,
      [remarkMath, { singleDollarTextMath: false }],
      ...extraSyntaxPlugins,
      remarkBreaks,
      remarkEmoji,
      remarkSqueezeParagraphs,
      remarkCjkFriendly,
      remarkCjkFriendlyGfmStrikethrough,
      ...displayPlugins,
    ] as never,
    rehypePlugins: [
      [rehypeRaw, { passThrough: [] }],
      [rehypeSanitize, { ...sanitizeSchema, clobberPrefix: TEST_CLOBBER_PREFIX }],
      rehypeFooterAdorn,
      [rehypeRebaseHashLinks, { prefix: TEST_CLOBBER_PREFIX }],
      rehypeKatex,
      rehypeUnwrapImages,
    ] as never,
    remarkRehypeOptions: {
      allowDangerousHtml: true,
      clobberPrefix: '',
      handlers: {
        ...(config.extras.includes('definitionList') ? defListHastHandlers : {}),
      },
    },
  };
}

function renderLegacy(md: string, config: PluginConfig): string {
  const { remarkPlugins, rehypePlugins, remarkRehypeOptions } = legacyPlugins(config);
  return renderToStaticMarkup(
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} remarkRehypeOptions={remarkRehypeOptions}>
      {md}
    </Markdown>
  );
}

function renderNew(md: string, config: PluginConfig, blockMemo = true, incrementalParse = false): string {
  const enginePlugins = [...config.extras, ...config.display].map((name) => SEALED_BY_NAME[name]);
  return renderToStaticMarkup(
    <AIMarkdownProvider
      streaming={false}
      fontSize="14px"
      variant="default"
      colorScheme="light"
      documentId={TEST_DOCUMENT_ID}
      blockMemo={blockMemo}
      incrementalParse={incrementalParse}
    >
      <AIMarkdownContent
        content={md}
        blockMemo={blockMemo}
        incrementalParse={incrementalParse}
        preserveOrphanReferences={true}
        enginePlugins={enginePlugins}
      />
    </AIMarkdownProvider>
  );
}

// ── Baseline cases (no extras / no display optimizers) ────────────────────

const baselineConfig: PluginConfig = { extras: [], display: [] };
const baselineCases: Array<[string, string]> = [
  ['single paragraph', 'Hello'],
  ['two paragraphs (whitespace text between blocks)', 'Hello\n\nWorld'],
  ['heading + paragraphs', '# Title\n\nBody\n\nMore'],
  ['indented raw HTML (leading text node)', '   <div>Hi</div>'],
  ['multi-root raw HTML with separator', '<div>A</div>\n\n<div>B</div>'],
  ['multi-root raw HTML inline (one mdast html, two hast divs)', '<div>A</div><div>B</div>'],
  ['footnote forward + back ref + section', 'See[^x].\n\n[^x]: hello'],
  ['footnote definition ABOVE its reference (orphan-seed regression)', '[^x]: hello\n\nSee[^x].'],
  ['list + table + code', 'A\n\n# H\n\n- li1\n- li2\n\n| c1 | c2 |\n|----|----|\n| a  | b  |\n\n```js\nx\n```\n\nP'],
  [
    'realistic AI response',
    '# Streaming AI Markdown\n\nThis is a **bold** test of the rendering pipeline with [a link](#anchor) and `code`.\n\n## Section 2\n\nSome math: $$x + y = z$$\n\n- Item one\n- Item two with [^a]\n- Item three\n\n| Col A | Col B |\n|-------|-------|\n| 1     | 2     |\n\n```typescript\nconst x: number = 42;\n```\n\n> Blockquote here.\n> Multi-line.\n\n[^a]: Footnote definition.\n\nEnd paragraph with emoji :smile:.',
  ],
];

// ── Extra-syntax cases (each plugin exercised individually) ───────────────

const extraSyntaxCases: Array<[string, PluginConfig, string]> = [
  [
    'mark highlight (==text==) — HIGHLIGHT plugin',
    { extras: ['highlight'], display: [] },
    'Some ==highlighted== text in a paragraph.\n\nAnother ==block== here.',
  ],
  [
    'definition list — DEFINITION_LIST plugin',
    { extras: ['definitionList'], display: [] },
    'Term\n:   Definition body one.\n\nOther\n:   Another definition.',
  ],
];

// ── Display-optimize cases (each plugin exercised individually) ───────────

const displayOptimizeCases: Array<[string, PluginConfig, string]> = [
  [
    'remove HTML comments — REMOVE_COMMENTS plugin',
    { extras: [], display: ['removeComments'] },
    'Before.\n\n<!-- hidden comment -->\n\nAfter.',
  ],
  [
    'smartypants curly quotes + em-dash — SMARTYPANTS plugin',
    { extras: [], display: ['smartypants'] },
    'He said "hello" -- and then walked away...',
  ],
  ['pangu CJK-Latin spacing — PANGU plugin', { extras: [], display: ['pangu'] }, '中文mixedwith English在一段里面。'],
];

// ── Default config (everything enabled, as <AIMarkdown> ships) ────────────

const defaultConfig: PluginConfig = { extras: ALL_EXTRAS, display: ALL_DISPLAY };
const defaultCases: Array<[string, string]> = [
  ['default config + simple paragraphs', 'Hello\n\nWorld'],
  [
    'default config + every-feature kitchen sink',
    '# Title\n\nIntro with ==mark== and H~2~O.\n\n<!-- hidden -->\n\n"Smart quotes" and 中文Latin spacing.\n\nTerm\n:   Definition.\n\nSee[^x].\n\n[^x]: footnote.',
  ],
];

describe('byte-equivalence (baseline plugins only)', () => {
  for (const [label, md] of baselineCases) {
    test(label, () => {
      expect(renderNew(md, baselineConfig)).toBe(renderLegacy(md, baselineConfig));
    });
  }
});

describe('byte-equivalence (extra-syntax plugins)', () => {
  for (const [label, config, md] of extraSyntaxCases) {
    test(label, () => {
      expect(renderNew(md, config)).toBe(renderLegacy(md, config));
    });
  }
});

describe('byte-equivalence (display-optimize plugins)', () => {
  for (const [label, config, md] of displayOptimizeCases) {
    test(label, () => {
      expect(renderNew(md, config)).toBe(renderLegacy(md, config));
    });
  }
});

describe('byte-equivalence (default config — everything enabled)', () => {
  for (const [label, md] of defaultCases) {
    test(label, () => {
      expect(renderNew(md, defaultConfig)).toBe(renderLegacy(md, defaultConfig));
    });
  }
});

// ── blockMemo toggle ───────────────────────────────────────────────────────

describe('byte-equivalence: blockMemo toggle produces identical output', () => {
  // Picks a cross-section of inputs that exercise each block-memo path:
  // single block, multi-block whitespace, raw HTML, footnote, kitchen sink.
  const toggleCases: Array<[string, PluginConfig, string]> = [
    ['single block', baselineConfig, 'Hello'],
    ['multi-block with inline whitespace', baselineConfig, 'Hello\n\nWorld'],
    ['multi-root raw HTML (shared mdast)', baselineConfig, '<div>A</div><div>B</div>'],
    ['footnote section', baselineConfig, 'See[^x].\n\n[^x]: hello'],
    ['footnote definition above its reference', baselineConfig, '[^x]: hello\n\nSee[^x].'],
    // Orphan definitions (no reference anywhere): the default policy keeps
    // them in the footer. The legacy path used to drop them — it never
    // merged the standalone footnoteDefinition handler — so `blockMemo`
    // was NOT output-invariant here (2026-08 project review, core-render-04).
    ['pure orphan definition', baselineConfig, '[^o]: orphan body'],
    ['orphan next to a cited note', baselineConfig, 'Cites[^a].\n\n[^a]: cited\n[^b]: orphan'],
    [
      'orphan definitions mid-stream (def before its later reference)',
      defaultConfig,
      '## Sources\n\n[^s]: soak\n[^t]: tag\n\nStill being written',
    ],
    [
      'kitchen sink with all plugins',
      defaultConfig,
      '# Title\n\nIntro with ==mark==.\n\nTerm\n:   Definition.\n\nSee[^x].\n\n[^x]: footnote.',
    ],
  ];
  for (const [label, config, md] of toggleCases) {
    test(`${label} — enabled === disabled`, () => {
      const enabled = renderNew(md, config, true);
      const disabled = renderNew(md, config, false);
      expect(enabled).toBe(disabled);
    });
  }

  test('orphan protection is really ON in both paths (not vacuously equal by both dropping the def)', () => {
    for (const blockMemo of [true, false]) {
      const html = renderNew('[^o]: orphan body', baselineConfig, blockMemo);
      expect(html, `blockMemo=${blockMemo}`).toContain('data-footnotes');
      expect(html, `blockMemo=${blockMemo}`).toContain('orphan body');
    }
  });
});

// ── incrementalParse toggle ────────────────────────────────────────────────
//
// One-shot SSR renders can NEVER exercise the incremental splice path: the
// per-instance state ref starts empty every render, so `advanceIncrementalParse`
// takes its internal full path (that is also why SSR correctness is untouched
// by the flag). This block therefore guards exactly one property: turning the
// flag ON does not perturb one-shot output. Frame-by-frame splice correctness
// is owned by `incrementalParse/spliceEquivalence.test.ts` (the arbiter) and
// the streaming Storybook play test.

describe('byte-equivalence: incrementalParse toggle produces identical output', () => {
  const toggleCases: Array<[string, PluginConfig, string]> = [
    ['single block', baselineConfig, 'Hello'],
    ['multi-block prose', baselineConfig, 'Hello\n\nWorld\n\nAgain'],
    ['multi-root raw HTML (shared mdast)', baselineConfig, '<div>A</div><div>B</div>'],
    ['footnote section (splices via injection replay since v2)', baselineConfig, 'See[^x].\n\n[^x]: hello'],
    ['footnote definition above its reference', baselineConfig, '[^x]: hello\n\nSee[^x].'],
    [
      'kitchen sink with all plugins',
      defaultConfig,
      '# Title\n\nIntro with ==mark==.\n\nTerm\n:   Definition.\n\nSee[^x].\n\n[^x]: footnote.',
    ],
  ];
  for (const [label, config, md] of toggleCases) {
    test(`${label} — incremental on === off`, () => {
      const on = renderNew(md, config, true, true);
      const off = renderNew(md, config, true, false);
      expect(on).toBe(off);
    });
  }
});

describe('cross-chunk semantic equivalence', () => {
  function renderSingle(source: string, documentId: string): string {
    return renderToStaticMarkup(<AIMarkdown content={source} documentId={documentId} />);
  }
  function renderChunked(chunks: string[], documentId: string): string {
    return renderToStaticMarkup(
      <AIMarkdownDocuments>
        {chunks.map((c, i) => (
          <AIMarkdown key={i} content={c} documentId={documentId} />
        ))}
      </AIMarkdownDocuments>
    );
  }

  // Server render under the wrapper: the registry exists but is EMPTY
  // (registerChunk/contribute run in effects), so every placeholder must
  // fall back to the chunk's own standalone facts — local footnote number,
  // local link/image def — and the output must be BYTE-identical to the
  // standalone render (2026-08 project review, core-render-02: marks and
  // reference links vanished from coordinated SSR while the local footer
  // still rendered with backrefs to nothing).
  describe('a wrapped chunk renders byte-identically to standalone on the server (empty registry)', () => {
    const cases: Array<[string, string]> = [
      [
        'footnote referenced twice + link ref + image ref',
        'Cites[^a] and [glossary][g] then [^a] again ![pic][g].\n\n[^a]: Note A.\n\n[g]: https://example.com/g "G"',
      ],
      ['two footnotes, def-before-ref order', '[^b]: B first.\n\nText[^a] then[^b].\n\n[^a]: A body.'],
      ['orphan definition next to a cited one', 'Cites[^a].\n\n[^a]: cited\n[^o]: orphan'],
      ['collapsed and shortcut link references', 'See [spec][] and [spec].\n\n[spec]: https://example.com/spec'],
      ['no references at all', '# Title\n\nPlain **prose** only.'],
      // v2.4.0 review: the four classes that broke the byte-identity claim.
      [
        'non-ASCII / percent / quote footnote labels (id encoding via normalizeUri)',
        'See[^注] and[^a%b] and[^q"x].\n\n[^注]: 中文\n\n[^a%b]: percent\n\n[^q"x]: quote',
      ],
      ['image reference alone in a paragraph (unwrap)', '![pic][x]\n\n![][x]\n\n[x]: https://example.com/p.png'],
      [
        'destination that normalizeUri rewrites (space, non-ASCII, quote)',
        '[a][x] [b][y] [c][z]\n\n[x]: <https://example.com/a b>\n[y]: https://example.com/日本\n[z]: https://example.com/q"x',
      ],
      [
        'blocked destinations render without href/src, not href=""',
        '[j][js] ![i][js] [m][my]\n\n[js]: javascript:alert(1)\n[my]: myapp://x',
      ],
      // v2.4.1 review: an EMPTY destination is legal (`[x]: <>`) and keeps
      // href=""/src="" in standalone — only a BLOCKED one drops the attribute.
      ['empty destination keeps href="" / src=""', '[e][x] ![i][x]\n\n[x]: <>'],
      // …and a linked image alone in a paragraph is unwrapped through the
      // link placeholder leg too.
      [
        'linked image reference alone in a paragraph (unwrap through the link)',
        '[![pic][p]][l]\n\n[p]: https://example.com/p.png\n[l]: https://example.com/l',
      ],
      [
        'inline image inside a link reference alone in a paragraph',
        '[![pic](https://example.com/p.png)][l]\n\n[l]: https://example.com/l',
      ],
    ];
    for (const [label, doc] of cases) {
      test(label, () => {
        expect(renderChunked([doc], 'doc-ssr')).toBe(renderSingle(doc, 'doc-ssr'));
      });
    }
    test('marks and links are really present (not vacuously equal by both being empty)', () => {
      const html = renderChunked([cases[0][1]], 'doc-ssr');
      expect(html).toContain('data-footnote-ref');
      expect(html).toContain('href="https://example.com/g"');
      expect(html).toContain('<img src="https://example.com/g"');
    });
  });

  function extractFootnoteItems(html: string): { label: string; text: string }[] {
    // crude but bounded: match all <li id="..." data-footnote-ref … >...</li>
    const re = /<li[^>]+id="[^"]*-user-content-fn-([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
    const out: { label: string; text: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      // Strip backref anchors (and their ↩ glyph children) before tag-strip
      // so single-doc rendering (which keeps backrefs) compares cleanly to
      // chunked rendering, where the aggregate footer is synthesised outside
      // mdast-util-to-hast's footer() and emits no backref anchors at all.
      const withoutBackrefs = m[2].replace(/<a[^>]*data-footnote-backref[^>]*>[\s\S]*?<\/a>/g, '');
      // strip remaining tags from text content
      const txt = withoutBackrefs.replace(/<[^>]*>/g, '').trim();
      out.push({ label: m[1], text: txt });
    }
    return out;
  }

  const corpus: [name: string, full: string, split: string[]][] = [
    ['fn-simple', 'See [^x].\n\n[^x]: hello', ['See [^x].\n', '\n[^x]: hello']],
    ['linkref-full', '[click][x]\n\n[x]: https://example.com', ['[click][x]\n', '\n[x]: https://example.com']],
    ['linkref-shortcut', '[x]\n\n[x]: https://example.com', ['[x]\n', '\n[x]: https://example.com']],
    ['linkref-collapsed', '[x][]\n\n[x]: https://example.com', ['[x][]\n', '\n[x]: https://example.com']],
  ];

  for (const [name, full, split] of corpus) {
    test(`semantic equivalence: ${name}`, () => {
      const singleHtml = renderSingle(full, name);
      const chunkedHtml = renderChunked(split, name);
      const singleItems = extractFootnoteItems(singleHtml);
      const chunkedItems = extractFootnoteItems(chunkedHtml);
      // Sort by label for stable comparison; chunked may scatter footers.
      const norm = (xs: typeof singleItems) => xs.slice().sort((a, b) => a.label.localeCompare(b.label));
      expect(norm(chunkedItems)).toEqual(norm(singleItems));
    });
  }
});
