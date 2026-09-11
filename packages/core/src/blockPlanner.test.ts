import { expect, test } from 'vitest';
import { advanceIncrementalParse, type IncrementalParseState } from '@ai-markdown/engine';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  buildCrossChunkHandlers,
  sanitizeSchema,
  defaultEnginePlugins,
  definitionList,
  removeComments,
  smartypants,
  pangu,
  type AIMarkdownEnginePlugin,
  type AdvanceOptions,
} from '@ai-markdown/engine';
// Keep the six migrated configuration cells, assembled only through public
// engine contracts. Core tests must not pull engine implementation fixtures.
const CATALOG = [
  { label: 'baseline', plugins: [], orphan: true },
  { label: 'defaults-all-on', plugins: defaultEnginePlugins, orphan: true },
  { label: 'def-list-only', plugins: [definitionList], orphan: true },
  { label: 'display-only', plugins: [removeComments, smartypants, pangu], orphan: true },
  { label: 'no-orphan', plugins: [], orphan: false },
  { label: 'defaults-no-orphan', plugins: defaultEnginePlugins, orphan: false },
];
function buildAdvanceOptions(config: {
  label: string;
  plugins: readonly AIMarkdownEnginePlugin[];
  orphan: boolean;
}): AdvanceOptions {
  const defListEnabled = config.plugins.includes(definitionList);
  const base = buildCoreRemarkRehypeOptions(defListEnabled);
  return {
    remarkPlugins: buildCoreRemarkPlugins(config.plugins),
    rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, 'ip-user-content-', { provenance: 'test-provenance' }),
    remarkRehypeOptions: {
      ...base,
      handlers: {
        ...base.handlers,
        ...(config.orphan ? { footnoteDefinition: buildCrossChunkHandlers().footnoteDefinition } : {}),
      },
      phantomFootnoteLabels: new Set(),
      phantomLinkLabels: new Set(),
      preserveOrphan: config.orphan,
      documentId: 'ip',
      provenance: 'test-provenance',
    } as AdvanceOptions['remarkRehypeOptions'],
    depsKey: [config.label],
    defListEnabled,
  };
}
import { buildBlocks } from './blockPlan';
import { createBlockPlanner } from './blockPlanner';

const docs = [
  'Stable **prefix**.\n\nSecond paragraph.\n\nThird.\n\n',
  'Prefix.\n\n- first\n- second\n\n```js\nx();\n```\n\nTail.',
  'Prefix.\n\nClaim[^a] and [link][b].\n\n[^a]: Footnote\n\n[b]: #target\n\nTail.',
  'Prefix.\n\n<details>\n\nClaim[^a]\n\n[^a]: Note\n\n</details>\n\nTail.',
  'Prefix.\n\nTerm\n: definition\n\n$$x^2$$\n\nTail.',
  'Claim[^a] and [link][x].\n\nAgain[^a].\n\n[^a]: Note with [link][x]\n\n[x]: /first\n\nTail[^a] and [link][x].\n\n[x]: /ignored',
  'Claim[^b].\n\nThen[^a] and again[^b].\n\n[^a]: Alpha\n\n[^b]: Beta\n\nTail[^c].\n\n[^c]: Gamma',
  // One mdast paragraph, several top-level hast siblings: rehype-unwrap-images
  // splits an image-only paragraph into `img, " ", img`. The retained-prefix
  // loop must keep every sibling of the reused node together with it.
  '![a](x.png) ![b](y.png)\n\nPara two.\n\nPara three.',
  '![a](x.png) ![b](y.png) ![c](z.png)\n\n![d](w.png)\n\nPara two.\n\n![e](v.png) ![f](u.png)\n\nPara three.\n\n',
];

test.each(CATALOG)('retained-prefix plans equal full plans at every append seam: $label', (config) => {
  const options = buildAdvanceOptions(config);
  for (const source of docs) {
    const plan = createBlockPlanner();
    let state: IncrementalParseState | null = null;
    for (let length = 1; length <= source.length; length++) {
      const text = source.slice(0, length);
      const result = advanceIncrementalParse(state, text, options);
      state = result.nextState;
      expect(plan(result.mdast, result.hast, text), `prefix ${JSON.stringify(text)}`).toEqual(
        buildBlocks(result.mdast, result.hast, text)
      );
    }
    // Equal content, a replacement, and a plugin-dependency change must all
    // remain equivalent, even after the planner has retained a long prefix.
    for (const text of [source, source.replace('Prefix', 'Edited'), 'replacement']) {
      const result = advanceIncrementalParse(state, text, { ...options, depsKey: [Symbol()] });
      state = result.nextState;
      expect(plan(result.mdast, result.hast, text)).toEqual(buildBlocks(result.mdast, result.hast, text));
    }
  }
});

test('reuses a reference prefix while preserving full context and tail occurrence counts', () => {
  const options = buildAdvanceOptions(CATALOG[0]);
  const plan = createBlockPlanner();
  const source = 'Claim[^a] and [link][x].\n\nAgain[^a].\n\n[^a]: Note\n\n[x]: /first\n\nTail.\n\n';
  const first = advanceIncrementalParse(null, source, options);
  const a = plan(first.mdast, first.hast, source);
  const text = source + 'More[^a] and [link][x].\n\n';
  const next = advanceIncrementalParse(first.nextState, text, options);
  const b = plan(next.mdast, next.hast, text);
  expect(a.blocks[0].hasReference).toBe(true);
  expect(b.blocks[0]).toBe(a.blocks[0]);
  expect(b).toEqual(buildBlocks(next.mdast, next.hast, text));
  const last = b.blocks.at(-1)!;
  expect(last.taintLabels?.footnoteRefLocalCtx).toBe(JSON.stringify([['A', 2, 0]]));
});

test('actually reuses retained block information, but resets on phantom-policy change', () => {
  const options = buildAdvanceOptions(CATALOG[0]);
  const plan = createBlockPlanner();
  const source = 'Stable prefix.\n\nSecond.\n\n';
  const first = advanceIncrementalParse(null, source, options);
  const a = plan(first.mdast, first.hast, source);
  const text = source + 'Tail.\n\n';
  const next = advanceIncrementalParse(first.nextState, text, options);
  const b = plan(next.mdast, next.hast, text);
  expect(b.blocks[0]).toBe(a.blocks[0]);
  const policy = { phantomFootnoteLabels: new Set(['A']) };
  const c = plan(next.mdast, next.hast, text, policy);
  expect(c.blocks[0]).not.toBe(b.blocks[0]);
  expect(c).toEqual(buildBlocks(next.mdast, next.hast, text, policy));
});

test('reuses every hast sibling of an unwrapped multi-image paragraph as one prefix node', () => {
  const options = buildAdvanceOptions(CATALOG[1]);
  const plan = createBlockPlanner();
  // The paragraph after the images confirms the block context, so the next
  // append splices with the whole image line inside the frozen prefix.
  const source = '![a](x.png) ![b](y.png)\n\nPara two.\n\n';
  const first = advanceIncrementalParse(null, source, options);
  const a = plan(first.mdast, first.hast, source);
  // rehype-unwrap-images split the paragraph into `img, " ", img`: two
  // block items sharing the paragraph's start offset.
  expect(a.blocks.map((b) => b.startOffset)).toEqual([0, 0, 25]);
  expect(a.plan.map((item) => item.kind)).toEqual(['block', 'inline', 'block', 'inline', 'block']);
  const text = `${source}Para three.\n\n`;
  const next = advanceIncrementalParse(first.nextState, text, options);
  expect(next.usedIncremental).toBe(true);
  expect(next.boundary).toBe(25);
  const b = plan(next.mdast, next.hast, text);
  expect(b).toEqual(buildBlocks(next.mdast, next.hast, text));
  // Both images came from the retained prefix, by identity.
  expect(b.blocks[0]).toBe(a.blocks[0]);
  expect(b.blocks[1]).toBe(a.blocks[1]);
  expect(b.plan.slice(0, 4)).toEqual(a.plan.slice(0, 4));
  // No uncached `inline-<offset>` fallback item for an element anywhere.
  expect(b.plan.filter((item) => item.kind === 'inline' && item.el.type === 'element')).toEqual([]);
});

test('coordinated <cross-chunk-image> siblings reuse the same way at every append seam', () => {
  // All four cross-chunk handlers: a locally defined image reference becomes
  // a `<cross-chunk-image>` placeholder, unwrapped like a plain `<img>`.
  const base = buildAdvanceOptions(CATALOG[1]);
  const baseOptions = base.remarkRehypeOptions as { handlers: object };
  const options: AdvanceOptions = {
    ...base,
    remarkRehypeOptions: {
      ...baseOptions,
      handlers: { ...baseOptions.handlers, ...buildCrossChunkHandlers() },
    } as AdvanceOptions['remarkRehypeOptions'],
    depsKey: ['coordinated-images'],
  };
  const source = '![a][x] ![b][y]\n\n[x]: x.png\n[y]: y.png\n\nPara two.\n\nPara three.\n\n';
  const plan = createBlockPlanner();
  let state: IncrementalParseState | null = null;
  let sawPlaceholder = false;
  for (let length = 1; length <= source.length; length++) {
    const text = source.slice(0, length);
    const result = advanceIncrementalParse(state, text, options);
    state = result.nextState;
    expect(plan(result.mdast, result.hast, text), `prefix ${JSON.stringify(text)}`).toEqual(
      buildBlocks(result.mdast, result.hast, text)
    );
    sawPlaceholder ||= result.hast.children.some((c) => c.type === 'element' && c.tagName === 'cross-chunk-image');
  }
  expect(sawPlaceholder).toBe(true);
});
