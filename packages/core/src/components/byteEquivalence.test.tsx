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
 *   `defaultAIMarkdownRenderConfig` (mark highlight, definition list,
 *   super/subscript, remove-comments, smartypants, pangu) MUST run on the
 *   same content as the legacy bare `<Markdown>` reference.
 */

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from './markdown';
import AIMarkdownContent from './MarkdownContent';
import AIMarkdownRenderStateProvider from '../context';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkEmoji from 'remark-emoji';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkMath from 'remark-math';
import { remarkMark as remarkMarkHighlight } from 'remark-mark-highlight';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import remarkSupersub from 'remark-supersub';
import remarkRemoveComments from 'remark-remove-comments';
import remarkSmartypants from 'remark-smartypants';
import remarkPangu from 'remark-pangu';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import { sanitizeSchema } from './sanitizeSchema';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import {
  AIMarkdownRenderExtraSyntax,
  AIMarkdownRenderDisplayOptimizeAbility,
  type AIMarkdownRenderConfig,
} from '../defs';

interface PluginConfig {
  extras: AIMarkdownRenderExtraSyntax[];
  display: AIMarkdownRenderDisplayOptimizeAbility[];
}

const ALL_EXTRAS: AIMarkdownRenderExtraSyntax[] = [
  AIMarkdownRenderExtraSyntax.HIGHLIGHT,
  AIMarkdownRenderExtraSyntax.DEFINITION_LIST,
  AIMarkdownRenderExtraSyntax.SUBSCRIPT,
];
const ALL_DISPLAY: AIMarkdownRenderDisplayOptimizeAbility[] = [
  AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS,
  AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS,
  AIMarkdownRenderDisplayOptimizeAbility.PANGU,
];

function legacyPlugins(config: PluginConfig) {
  // Mirrors MarkdownContent.tsx's plugin assembly order EXACTLY so any
  // ordering bug shows up here.
  const extraSyntaxPlugins = config.extras.map((syntax) => {
    switch (syntax) {
      case AIMarkdownRenderExtraSyntax.HIGHLIGHT:
        return remarkMarkHighlight;
      case AIMarkdownRenderExtraSyntax.DEFINITION_LIST:
        return remarkDefinitionList;
      case AIMarkdownRenderExtraSyntax.SUBSCRIPT:
        return remarkSupersub;
    }
  });
  const displayPlugins = config.display.map((ability) => {
    switch (ability) {
      case AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS:
        return remarkRemoveComments;
      case AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS:
        return remarkSmartypants;
      case AIMarkdownRenderDisplayOptimizeAbility.PANGU:
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
      [rehypeSanitize, sanitizeSchema],
      rehypeRebaseHashLinks,
      rehypeKatex,
      rehypeUnwrapImages,
    ] as never,
    remarkRehypeOptions: {
      allowDangerousHtml: true,
      clobberPrefix: '',
      handlers: {
        ...(config.extras.includes(AIMarkdownRenderExtraSyntax.DEFINITION_LIST) ? defListHastHandlers : {}),
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

function renderNew(md: string, config: PluginConfig, blockMemoEnabled = true): string {
  const cfg: AIMarkdownRenderConfig = {
    extraSyntaxSupported: config.extras,
    displayOptimizeAbilities: config.display,
    blockMemoEnabled,
  };
  return renderToStaticMarkup(
    <AIMarkdownRenderStateProvider streaming={false} fontSize="14px" variant="default" colorScheme="light" config={cfg}>
      <AIMarkdownContent content={md} />
    </AIMarkdownRenderStateProvider>
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
    { extras: [AIMarkdownRenderExtraSyntax.HIGHLIGHT], display: [] },
    'Some ==highlighted== text in a paragraph.\n\nAnother ==block== here.',
  ],
  [
    'definition list — DEFINITION_LIST plugin',
    { extras: [AIMarkdownRenderExtraSyntax.DEFINITION_LIST], display: [] },
    'Term\n:   Definition body one.\n\nOther\n:   Another definition.',
  ],
  [
    'super/subscript (H~2~O, e^iπ^) — SUBSCRIPT plugin',
    { extras: [AIMarkdownRenderExtraSyntax.SUBSCRIPT], display: [] },
    'Water is H~2~O and e^iπ^ = -1.',
  ],
];

// ── Display-optimize cases (each plugin exercised individually) ───────────

const displayOptimizeCases: Array<[string, PluginConfig, string]> = [
  [
    'remove HTML comments — REMOVE_COMMENTS plugin',
    { extras: [], display: [AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS] },
    'Before.\n\n<!-- hidden comment -->\n\nAfter.',
  ],
  [
    'smartypants curly quotes + em-dash — SMARTYPANTS plugin',
    { extras: [], display: [AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS] },
    'He said "hello" -- and then walked away...',
  ],
  [
    'pangu CJK-Latin spacing — PANGU plugin',
    { extras: [], display: [AIMarkdownRenderDisplayOptimizeAbility.PANGU] },
    '中文mixedwith English在一段里面。',
  ],
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

// ── blockMemoEnabled toggle ────────────────────────────────────────────────

describe('byte-equivalence: blockMemoEnabled toggle produces identical output', () => {
  // Picks a cross-section of inputs that exercise each block-memo path:
  // single block, multi-block whitespace, raw HTML, footnote, kitchen sink.
  const toggleCases: Array<[string, PluginConfig, string]> = [
    ['single block', baselineConfig, 'Hello'],
    ['multi-block with inline whitespace', baselineConfig, 'Hello\n\nWorld'],
    ['multi-root raw HTML (shared mdast)', baselineConfig, '<div>A</div><div>B</div>'],
    ['footnote section', baselineConfig, 'See[^x].\n\n[^x]: hello'],
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
});
