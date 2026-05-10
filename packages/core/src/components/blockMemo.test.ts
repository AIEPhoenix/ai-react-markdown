/**
 * Tests for block-level memoization. Covers buildBlocks (hast-driven block
 * extraction + ctx digest) and renderBlocksWithCache (per-block cache
 * identity + footnote single-slot + atomic Cache replacement).
 *
 * Cache hits are asserted by referential equality of the returned ReactNodes
 * across frames — when a block is cached, `renderBlocksWithCache` returns the
 * exact `node` reference stored in the prior frame's Cache.
 */

import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkRemoveComments from 'remark-remove-comments';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { VFile } from 'vfile';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { sanitizeSchema } from './sanitizeSchema';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import type { ReactNode } from 'react';
import {
  buildBlocks,
  createCache,
  isFootnoteSection,
  hasMdastSource,
  renderBlocksWithCache,
  type Cache,
  type PostOptions,
} from './blockMemo';

interface PipelineOptions {
  removeComments?: boolean;
}

function buildProcessor(options: PipelineOptions = {}) {
  let processor = unified().use(remarkParse).use(remarkGfm).use(remarkSqueezeParagraphs);
  if (options.removeComments) {
    processor = processor.use(remarkRemoveComments);
  }
  return processor
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
    .use(rehypeRaw, { passThrough: [] })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeRebaseHashLinks);
}

function runPipeline(content: string, options: PipelineOptions = {}): { mdast: MdastRoot; hast: HastRoot } {
  const processor = buildProcessor(options);
  const file = new VFile({ value: content });
  const mdast = processor.parse(file);
  const hast = processor.runSync(mdast, file) as HastRoot;
  return { mdast, hast };
}

const emptyPostOptions: PostOptions = {};

function frame(content: string, cacheRef: { current: Cache }, options: PipelineOptions = {}) {
  const { mdast, hast } = runPipeline(content, options);
  const built = buildBlocks(mdast, hast, content);
  const all = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, emptyPostOptions);
  // Tests inspect cache identity at the block / synthetic level. Inlines
  // (top-level whitespace text inserted by mdast-util-to-hast between block
  // elements) are intentionally rendered fresh every frame and would skew
  // the index-based assertions, so filter them out for the tests' view.
  const rendered: ReactNode[] = [];
  for (let i = 0; i < built.plan.length; i++) {
    if (built.plan[i].kind === 'inline') continue;
    rendered.push(all[i].node);
  }
  return { built, rendered, cache: cacheRef.current };
}

// ─── isFootnoteSection / hasMdastSource ───────────────────────────────────

describe('isFootnoteSection', () => {
  test('true for <section data-footnotes>', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'section',
      properties: { dataFootnotes: true },
      children: [],
    };
    expect(isFootnoteSection(node)).toBe(true);
  });

  test('false for <section> without dataFootnotes', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'section',
      properties: {},
      children: [],
    };
    expect(isFootnoteSection(node)).toBe(false);
  });

  test('false for <div data-footnotes> (wrong tag)', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'div',
      properties: { dataFootnotes: true },
      children: [],
    };
    expect(isFootnoteSection(node)).toBe(false);
  });
});

describe('hasMdastSource', () => {
  test('true when position is set', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
      position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 2, offset: 1 } },
    };
    expect(hasMdastSource(node)).toBe(true);
  });

  test('false when position is missing', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
    };
    expect(hasMdastSource(node)).toBe(false);
  });
});

// ─── buildBlocks: structure ────────────────────────────────────────────────

describe('buildBlocks', () => {
  test('paragraph blocks: 1:1 with mdast top-level', () => {
    const { mdast, hast } = runPipeline('Hello\n\nWorld');
    const built = buildBlocks(mdast, hast, 'Hello\n\nWorld');
    expect(built.blocks).toHaveLength(2);
    expect(built.blockHasts).toHaveLength(2);
    expect(built.synthetic).toBeUndefined();
    expect(built.globalCtx).toBe('[]');
    expect(built.blocks[0].raw).toBe('Hello');
    expect(built.blocks[1].raw).toBe('World');
  });

  test('hast-driven: HTML comment removed by plugin does not break invariant', () => {
    const md = 'Hello\n\n<!-- comment -->\n\nWorld';
    const { mdast, hast } = runPipeline(md, { removeComments: true });
    const built = buildBlocks(mdast, hast, md);
    // remarkRemoveComments drops the html-comment paragraph from mdast →
    // hast has 2 elements, blocks must match.
    expect(built.blocks).toHaveLength(built.blockHasts.length);
    expect(built.blocks).toHaveLength(2);
  });

  test('hast-driven: empty paragraphs squeezed away', () => {
    // remarkSqueezeParagraphs removes paragraphs that contain no content.
    // Triple blank lines collapse — hast ends up with fewer top-level
    // elements than the raw mdast parse.
    const md = 'A\n\n\n\nB';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(built.blockHasts.length);
  });

  test('synthetic footnote section detected and excluded from blocks', () => {
    const md = 'See[^x].\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.synthetic).toBeDefined();
    expect(built.synthetic?.tagName).toBe('section');
    // The footnote definition is hoisted out of mdast.children and into the
    // synthetic section; only the paragraph "See[^x]." remains as a block.
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].hasReference).toBe(true);
  });

  test('globalCtx records footnoteRef order', () => {
    const md1 = 'A[^x] B[^y].\n\n[^x]: x\n\n[^y]: y';
    const md2 = 'A[^y] B[^x].\n\n[^x]: x\n\n[^y]: y';
    const r1 = runPipeline(md1);
    const r2 = runPipeline(md2);
    const c1 = buildBlocks(r1.mdast, r1.hast, md1).globalCtx;
    const c2 = buildBlocks(r2.mdast, r2.hast, md2).globalCtx;
    expect(c1).not.toBe(c2);
  });

  test('globalCtx serialization avoids separator collision', () => {
    const md = '[a:b]: https://x.com\n\n[a:b]\n\n[c]: https://y.com|d\n\n[c]';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    // Just sanity-check JSON round-trips and contains both definitions.
    const parts = JSON.parse(built.globalCtx);
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.length).toBeGreaterThan(0);
  });

  test('hasReference: tainted block flagged, untainted block not', () => {
    const md = 'See[^x].\n\nPlain.\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(2);
    const seeBlock = built.blocks.find((b) => b.raw.startsWith('See'));
    const plainBlock = built.blocks.find((b) => b.raw === 'Plain.');
    expect(seeBlock?.hasReference).toBe(true);
    expect(plainBlock?.hasReference).toBe(false);
  });

  test('internal hash link is NOT tainted', () => {
    const md = 'Text [link](#x).';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].hasReference).toBe(false);
  });
});

// ─── renderBlocksWithCache: per-block hit/miss ─────────────────────────────

describe('renderBlocksWithCache — block identity', () => {
  test('identical content across frames: every block hits', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Hello\n\nWorld', cacheRef);
    const f2 = frame('Hello\n\nWorld', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[1]).toBe(f1.rendered[1]);
  });

  test('streaming append: prior blocks hit, new block fresh', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Hello\n\nWorld', cacheRef);
    const f2 = frame('Hello\n\nWorld\n\nMore', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[1]).toBe(f1.rendered[1]);
    expect(f2.rendered[2]).not.toBe(f1.rendered[1]);
  });

  test('self-correction: prefix changes → all subsequent offsets drift → miss', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Hi\n\nWorld', cacheRef);
    const f2 = frame('Hello\n\nWorld', cacheRef);
    // Block "World" raw is unchanged but its startOffset shifted (4 → 7).
    expect(f2.built.blocks[1].raw).toBe('World');
    expect(f1.built.blocks[1].startOffset).not.toBe(f2.built.blocks[1].startOffset);
    expect(f2.rendered[1]).not.toBe(f1.rendered[1]);
  });

  test('duplicate raw: bucket per occurrence', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('---\n\nMid\n\n---', cacheRef);
    expect(f1.built.blocks).toHaveLength(3);
    // Same raw twice for the two thematic breaks → two bucket entries.
    const bucket = f1.cache.blocks.get(f1.built.blocks[0].raw);
    expect(bucket?.length).toBe(2);
    // Frame 2 hits both occurrences.
    const f2 = frame('---\n\nMid\n\n---', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[2]).toBe(f1.rendered[2]);
  });

  test('partial hit on duplicate raw: bucket[0] hits, bucket[1] miss when offset drifts', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('---\n\nMid\n\n---', cacheRef);
    // Insert text before second --- so its offset changes
    const f2 = frame('---\n\nMidText\n\n---', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    // Second --- has different startOffset → miss even though same raw + same bucket index
    expect(f2.built.blocks[2].raw).toBe('---');
    expect(f2.built.blocks[2].startOffset).not.toBe(f1.built.blocks[2].startOffset);
    expect(f2.rendered[2]).not.toBe(f1.rendered[2]);
  });
});

// ─── renderBlocksWithCache: ctx invalidation ───────────────────────────────

describe('renderBlocksWithCache — ctx invalidation', () => {
  test('tainted block hits when only an unrelated paragraph changes', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\nPlain.\n\n[^x]: hello', cacheRef);
    const f2 = frame('See[^x].\n\nDifferent.\n\n[^x]: hello', cacheRef);
    // First block (tainted) raw + ctx + offset unchanged → hit.
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
  });

  test('changing a footnote definition url/body invalidates dependent block', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\n[^x]: original', cacheRef);
    const f2 = frame('See[^x].\n\n[^x]: updated', cacheRef);
    // The "See[^x]." block has the same raw + offset, but globalCtx changed
    // (footnoteDefinition body). Tainted blocks invalidate → miss.
    expect(f2.built.blocks[0].raw).toBe(f1.built.blocks[0].raw);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });

  test('reordering footnote refs (same multiset) invalidates tainted block', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('A[^x] B[^y].\n\n[^x]: x\n\n[^y]: y', cacheRef);
    const f2 = frame('A[^y] B[^x].\n\n[^x]: x\n\n[^y]: y', cacheRef);
    // Same set of refs but different order → globalCtx differs → ref-bearing
    // block must invalidate (footnote numbering depends on first-occurrence order).
    expect(f1.built.globalCtx).not.toBe(f2.built.globalCtx);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });

  test('linkRef block invalidates when its definition changes', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('[ref][a]\n\n[a]: https://x.com', cacheRef);
    const f2 = frame('[ref][a]\n\n[a]: https://y.com', cacheRef);
    expect(f1.built.globalCtx).not.toBe(f2.built.globalCtx);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });
});

// ─── footnote synthetic section: single-slot cache ─────────────────────────

describe('renderBlocksWithCache — footnote section', () => {
  test('section reused across frames when globalCtx unchanged', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    const f2 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    const sectionIdx = f1.built.blocks.length;
    expect(f2.rendered[sectionIdx]).toBe(f1.rendered[sectionIdx]);
  });

  test('toggle T1→T2→T3 (footnote present → absent → present) re-renders T3', () => {
    const cacheRef = { current: createCache() };
    const t1 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    expect(t1.cache.footnoteSection).toBeDefined();
    const t2 = frame('Plain text.', cacheRef);
    expect(t2.cache.footnoteSection).toBeUndefined();
    const t3 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    expect(t3.cache.footnoteSection).toBeDefined();
    // Section was wiped during T2 (no synthetic), so T3 must produce a
    // fresh node — design trade-off documented.
    const sectionIdx = t1.built.blocks.length;
    expect(t3.rendered[sectionIdx]).not.toBe(t1.rendered[sectionIdx]);
  });
});

// ─── atomic Cache replacement ──────────────────────────────────────────────

describe('renderBlocksWithCache — atomic replacement', () => {
  test('cacheRef.current is a brand-new Cache after each call', () => {
    const cacheRef = { current: createCache() };
    const before = cacheRef.current;
    frame('Hello', cacheRef);
    expect(cacheRef.current).not.toBe(before);
  });

  test('renders left over from prior frame are not retained when their raw disappears', () => {
    const cacheRef = { current: createCache() };
    frame('Hello\n\nWorld', cacheRef);
    expect(cacheRef.current.blocks.has('Hello')).toBe(true);
    expect(cacheRef.current.blocks.has('World')).toBe(true);
    frame('Goodbye', cacheRef);
    expect(cacheRef.current.blocks.has('Hello')).toBe(false);
    expect(cacheRef.current.blocks.has('World')).toBe(false);
    expect(cacheRef.current.blocks.has('Goodbye')).toBe(true);
  });
});

// ─── invariants ────────────────────────────────────────────────────────────

describe('renderBlocksWithCache — dev invariants', () => {
  test('throws when a block plan item has no position on its hast element', () => {
    // Simulate a buggy buildBlocks (or downstream rehype plugin) that produced
    // a `block` plan item whose hast element lost its `position`. The dev
    // invariant in renderBlocksWithCache must trip.
    const cacheRef = { current: createCache() };
    const fakeChild: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
    };
    expect(() =>
      renderBlocksWithCache(
        cacheRef,
        [
          {
            kind: 'block',
            el: fakeChild,
            reactKey: 'block-0',
            info: { raw: 'a', startOffset: 0, endOffset: 1, startLine: 1, startColumn: 1, hasReference: false },
          },
        ],
        '[]',
        emptyPostOptions
      )
    ).toThrow(/position/);
  });
});

// ─── empty / edge documents ────────────────────────────────────────────────

describe('buildBlocks — edge documents', () => {
  test('empty content: no blocks, no synthetic', () => {
    const { mdast, hast } = runPipeline('');
    const built = buildBlocks(mdast, hast, '');
    expect(built.blocks).toHaveLength(0);
    expect(built.synthetic).toBeUndefined();
  });

  test('orphan footnoteDefinition only: no blocks, no synthetic (no refs to hoist)', () => {
    // gfm parses `[^x]: hi` but mdast-util-to-hast only synthesizes the
    // section when there's at least one footnoteReference. Without refs,
    // the def is dropped and we get an empty doc.
    const md = '[^x]: hi';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(0);
    expect(built.synthetic).toBeUndefined();
  });
});

// ─── raw HTML edge cases (validates two-tier offset lookup + occurrence index) ─

describe('buildBlocks — raw HTML', () => {
  test('indented raw HTML: hast div at offset 3, mdast html at 0 — range fallback wins', () => {
    // `   <div>Hi</div>` → one mdast `html` node spanning [0,16]; hast emits
    // a leading text node and a `<div>` element starting at offset 3. The
    // exact-offset Map miss for offset 3 forces the range-containment
    // findLast fallback to recover the mdast html as the source.
    const md = '   <div>Hi</div>';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].startOffset).toBe(0);
    expect(built.blocks[0].raw).toBe(md);
  });

  test('multi-root raw HTML: two hast divs share one mdast html — bucket has both', () => {
    // One mdast html node at [0,24] becomes two sibling divs in hast at
    // [0,12] and [12,24]. Both look up to the same mdast counterpart →
    // identical raw → bucket array carries two occurrences.
    const md = '<div>A</div><div>B</div>';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(2);
    expect(built.blocks[0].raw).toBe(md);
    expect(built.blocks[1].raw).toBe(md);
    expect(built.blocks[0].startOffset).toBe(built.blocks[1].startOffset);
  });

  test('multi-root raw HTML partial change: BOTH blocks miss (mdast-node-level identity)', () => {
    // Design contract: cache identity = mdast-node-level. Both hast divs
    // share one mdast html source string, so changing any inner div mutates
    // the parent raw → bucket key changes for all occurrences. This is by
    // design, not a bug.
    const cacheRef = { current: createCache() };
    const f1 = frame('<div>A</div><div>B</div>', cacheRef);
    const f2 = frame('<div>D</div><div>B</div>', cacheRef);
    expect(f1.built.blocks).toHaveLength(2);
    expect(f2.built.blocks).toHaveLength(2);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
    expect(f2.rendered[1]).not.toBe(f1.rendered[1]);
  });

  test('multi-root raw HTML unchanged: both hast divs hit cache via bucket index', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('<div>A</div><div>B</div>', cacheRef);
    const f2 = frame('<div>A</div><div>B</div>', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[1]).toBe(f1.rendered[1]);
  });
});

// ─── synthesized hast nodes (no mdast counterpart / no position) ──────────

describe('buildBlocks — synthesized hast nodes', () => {
  test('throws when a hast block has no mdast counterpart', () => {
    // Simulate a rehype plugin that synthesized a block at an offset that
    // does not correspond to any mdast top-level node nor any range.
    const mdast: MdastRoot = { type: 'root', children: [] };
    const hast: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'div',
          properties: {},
          children: [],
          position: {
            start: { line: 1, column: 1, offset: 999 },
            end: { line: 1, column: 2, offset: 1000 },
          },
        },
      ],
    };
    expect(() => buildBlocks(mdast, hast, '')).toThrow(/no mdast counterpart/);
  });

  test('synthesized <div> without position is rendered as inline, NOT misidentified as footnote section', () => {
    // A rehype plugin might append a position-less <div>. `isFootnoteSection`
    // checks tagName + dataFootnotes, so this div must NOT be promoted to
    // `synthetic`. Without an mdast counterpart (no offset), it falls into
    // the inline path — rendered every frame, never cached, but content is
    // preserved (we don't silently drop user content).
    const md = 'Hi';
    const { mdast, hast } = runPipeline(md);
    hast.children.push({
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [],
    });
    const built = buildBlocks(mdast, hast, md);
    expect(built.synthetic).toBeUndefined();
    expect(built.blocks).toHaveLength(1);
    // The orphan div is in the plan as inline (preserves it in render output).
    expect(built.plan.some((p) => p.kind === 'inline' && p.el === hast.children[hast.children.length - 1])).toBe(true);
  });
});

// ─── G3 flush contract (cacheRef external reset) ──────────────────────────

describe('renderBlocksWithCache — G3 flush contract', () => {
  test('externally resetting cacheRef forces miss on the next frame', () => {
    // The MarkdownContent G3 flush works by replacing cacheRef.current with
    // a fresh Cache when any of the 10 tracked deps change identity. From
    // renderBlocksWithCache's perspective, this manifests as "prev cache is
    // empty even though content is unchanged".
    const cacheRef = { current: createCache() };
    const f1 = frame('Hello\n\nWorld', cacheRef);
    cacheRef.current = createCache();
    const f2 = frame('Hello\n\nWorld', cacheRef);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
    expect(f2.rendered[1]).not.toBe(f1.rendered[1]);
  });

  test('reset also discards the footnote synthetic single-slot', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    expect(cacheRef.current.footnoteSection).toBeDefined();
    cacheRef.current = createCache();
    expect(cacheRef.current.footnoteSection).toBeUndefined();
    const f2 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    const sectionIdx = f1.built.blocks.length;
    expect(f2.rendered[sectionIdx]).not.toBe(f1.rendered[sectionIdx]);
  });
});

// ─── React key uniqueness (multi-root raw HTML) ────────────────────────────

describe('buildBlocks — React key uniqueness', () => {
  test('multi-root raw HTML produces unique React keys despite shared mdast source', () => {
    // Regression: prior implementation used `block-${mdastStart}` as the key,
    // causing both hast <div>s (which share one mdast `html` node) to collide
    // on the same React key. Keys are now derived from each hast element's
    // own offset, which is unique per rendered top-level child.
    const md = '<div>A</div><div>B</div>';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const blockKeys = built.plan
      .filter((p): p is Extract<typeof p, { kind: 'block' }> => p.kind === 'block')
      .map((p) => p.reactKey);
    expect(blockKeys.length).toBeGreaterThan(1);
    expect(new Set(blockKeys).size).toBe(blockKeys.length);
  });

  test('all plan items have globally unique reactKey within the plan', () => {
    // Stronger: any pair of plan items (block / inline / synthetic) must have
    // distinct React keys, otherwise React will warn and reuse fibers wrongly.
    const md = '<div>A</div><div>B</div>\n\nSee[^x].\n\n   <span>indented</span>\n\n[^x]: x';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const allKeys = built.plan.map((p) => p.reactKey);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});

// ─── Position triple validity (line/column false-positive defence) ─────────

describe('renderBlocksWithCache — position triple validity', () => {
  test('cache miss when startLine differs even if startOffset matches', () => {
    // Regression: prior implementation only filtered by startOffset, so two
    // different documents that happen to put "Target" at the same byte offset
    // (but on different lines) would falsely hit the cache. The cached node's
    // `node.position.start.line` would then be stale for custom components
    // that read it via `passNode: true`.
    const cacheRef = { current: createCache() };
    const f1 = frame('A\n\nB\n\nTarget', cacheRef);
    const targetBlockF1 = f1.built.blocks.find((b) => b.raw === 'Target');
    expect(targetBlockF1).toBeDefined();
    expect(targetBlockF1!.startOffset).toBe(6);
    expect(targetBlockF1!.startLine).toBe(5);

    const f2 = frame('ABCD\n\nTarget', cacheRef);
    const targetBlockF2 = f2.built.blocks.find((b) => b.raw === 'Target');
    expect(targetBlockF2).toBeDefined();
    expect(targetBlockF2!.startOffset).toBe(6); // same offset
    expect(targetBlockF2!.startLine).toBe(3); // but different line
    // Cache MUST miss → fresh ReactNode reference.
    const idx = f2.built.blocks.indexOf(targetBlockF2!);
    expect(f2.rendered[idx]).not.toBe(f1.rendered[f1.built.blocks.indexOf(targetBlockF1!)]);
  });

  test('cache miss when startColumn differs (column-only drift)', () => {
    // Constructing a pure column-only drift on a top-level block via stock
    // markdown is artificial, so we drive renderBlocksWithCache directly with
    // a hand-crafted plan to exercise the column branch of the validity check.
    const cacheRef = { current: createCache() };
    const baseEl: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 2, offset: 1 },
      },
    };
    const driftedEl: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
      position: {
        start: { line: 1, column: 2, offset: 0 }, // same offset, different column
        end: { line: 1, column: 3, offset: 1 },
      },
    };
    const r1 = renderBlocksWithCache(
      cacheRef,
      [
        {
          kind: 'block',
          el: baseEl,
          reactKey: 'block-0',
          info: {
            raw: 'p',
            startOffset: 0,
            endOffset: 1,
            startLine: 1,
            startColumn: 1,
            hasReference: false,
          },
        },
      ],
      '[]',
      emptyPostOptions
    );
    const r2 = renderBlocksWithCache(
      cacheRef,
      [
        {
          kind: 'block',
          el: driftedEl,
          reactKey: 'block-0',
          info: {
            raw: 'p',
            startOffset: 0,
            endOffset: 1,
            startLine: 1,
            startColumn: 2,
            hasReference: false,
          },
        },
      ],
      '[]',
      emptyPostOptions
    );
    expect(r2[0].node).not.toBe(r1[0].node);
  });
});

// ─── footnoteDefinition range-fallback safety ──────────────────────────────

describe('buildBlocks — footnoteDefinition fallback parity', () => {
  test('range-fallback resolving to a footnoteDefinition preserves the hast element as inline', () => {
    // Defensive parity with the other no-counterpart fallbacks: if a future
    // rehype plugin synthesizes a hast element whose offset lands inside a
    // footnoteDefinition's mdast source range, it must be rendered as inline
    // (preserved), NOT silently dropped from the plan.
    const md = 'See[^x].\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    // mdast `[^x]: hello` spans some offset range (e.g., [10, 21]).
    const footnoteDef = mdast.children.find((c) => c.type === 'footnoteDefinition');
    expect(footnoteDef).toBeDefined();
    const startOffset = footnoteDef!.position?.start.offset;
    expect(startOffset).toBeDefined();
    const innerOffset = startOffset! + 1;

    // Inject a synthetic hast element whose offset falls inside that range
    // but doesn't exact-match any mdast node — forces the range fallback.
    hast.children.push({
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [],
      position: {
        start: { line: 1, column: 1, offset: innerOffset },
        end: { line: 1, column: 2, offset: innerOffset + 1 },
      },
    });

    const built = buildBlocks(mdast, hast, md);
    // The synthetic span must appear as inline in the plan (preserved).
    const inlineFromFallback = built.plan.find((p) => p.kind === 'inline' && (p.el as HastElement).tagName === 'span');
    expect(inlineFromFallback).toBeDefined();
  });
});

// ─── inline non-element preservation ──────────────────────────────────────

describe('buildBlocks — inline (non-element) top-level children', () => {
  test('whitespace text between blocks is included in plan as inline items', () => {
    // mdast-util-to-hast inserts `\n` text nodes between top-level block
    // elements. They must survive into the plan so renderBlocksWithCache
    // can re-emit them — preserving react-markdown's byte-equivalent output.
    const md = 'Hello\n\nWorld';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(2);
    const inlines = built.plan.filter((p) => p.kind === 'inline');
    expect(inlines.length).toBeGreaterThan(0);
    // Plan order: block, inline, block (at minimum).
    expect(built.plan[0].kind).toBe('block');
    expect(built.plan[built.plan.length - 1].kind).toBe('block');
  });

  test('inline items get stable React keys (offset-based when position is set, index-based fallback otherwise)', () => {
    // mdast-util-to-hast sometimes omits `position` on the synthesized
    // whitespace text nodes it inserts between block elements. Both key
    // forms are stable across re-renders:
    //   - `inline-${offset}`: when the node carries position
    //   - `inline-i${planIndex}`: index in the plan (stable as long as
    //     document structure doesn't change between adjacent frames)
    const md = 'A\n\nB';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const inline = built.plan.find((p) => p.kind === 'inline');
    expect(inline).toBeDefined();
    expect(inline!.reactKey).toMatch(/^inline-(\d+|i\d+)$/);
  });

  test('inline items render every frame (no caching) — different ReactNode references', () => {
    const cacheRef = { current: createCache() };
    const { mdast: m1, hast: h1 } = runPipeline('A\n\nB');
    const built1 = buildBlocks(m1, h1, 'A\n\nB');
    const r1 = renderBlocksWithCache(cacheRef, built1.plan, built1.globalCtx, emptyPostOptions);
    const { mdast: m2, hast: h2 } = runPipeline('A\n\nB');
    const built2 = buildBlocks(m2, h2, 'A\n\nB');
    const r2 = renderBlocksWithCache(cacheRef, built2.plan, built2.globalCtx, emptyPostOptions);
    // Find inline indices.
    const inlineIndices = built1.plan.map((p, i) => (p.kind === 'inline' ? i : -1)).filter((i) => i !== -1);
    expect(inlineIndices.length).toBeGreaterThan(0);
    // Inline ReactNodes are freshly created each frame; reference inequality
    // is expected (and acceptable — they are cheap and rarely larger than 1 char).
    for (const i of inlineIndices) {
      expect(r2[i].node).not.toBe(r1[i].node);
    }
    // Block nodes still hit cache despite the inline re-render.
    const blockIndices = built1.plan.map((p, i) => (p.kind === 'block' ? i : -1)).filter((i) => i !== -1);
    for (const i of blockIndices) {
      expect(r2[i].node).toBe(r1[i].node);
    }
  });

  test('synthetic footnote section appears as kind=synthetic in plan, last position', () => {
    const md = 'See[^x].\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const synthetic = built.plan.find((p) => p.kind === 'synthetic');
    expect(synthetic).toBeDefined();
    expect(synthetic!.reactKey).toBe('__footnote_section__');
    expect(built.plan.findIndex((p) => p.kind === 'synthetic')).toBe(built.plan.length - 1);
  });
});

// ─── miscellaneous correctness scenarios ──────────────────────────────────

describe('renderBlocksWithCache — misc scenarios', () => {
  test('setext heading raw stable across streaming append', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Title\n=====\n\nBody', cacheRef);
    const f2 = frame('Title\n=====\n\nBody more', cacheRef);
    // The setext heading sits at offset 0 in both frames with identical raw,
    // so it must hit cache regardless of edits to the trailing block.
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
  });

  test('external URL with hash does not taint the block — hits cache across frames', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Visit [home](https://x.com#section).', cacheRef);
    expect(f1.built.blocks[0].hasReference).toBe(false);
    const f2 = frame('Visit [home](https://x.com#section).', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
  });

  test('changing footnote ref count in another paragraph invalidates ref-bearing block', () => {
    // A[^x] alone in T1 → globalCtx records [^x] once.
    // T2 adds another [^x] inline somewhere → globalCtx records [^x] twice.
    // The first block's raw + offset are identical, but its rendered output
    // depends on backref count → must invalidate.
    const cacheRef = { current: createCache() };
    const f1 = frame('A[^x].\n\nPlain.\n\n[^x]: x', cacheRef);
    const f2 = frame('A[^x].\n\nAlso[^x].\n\n[^x]: x', cacheRef);
    expect(f1.built.globalCtx).not.toBe(f2.built.globalCtx);
    expect(f2.built.blocks[0].raw).toBe(f1.built.blocks[0].raw);
    expect(f2.built.blocks[0].startOffset).toBe(f1.built.blocks[0].startOffset);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });

  test('postOptions reference change has no effect on cache identity (G3 is upstream)', () => {
    // Cache key = (raw, occurrence, ctx, startOffset). postOptions does not
    // appear in the key — invalidation on postOptions change is the G3
    // flush layer's responsibility (tested above). At this layer, identical
    // (blocks, ctx) with a fresh-reference postOptions object still hits.
    const cacheRef = { current: createCache() };
    const { mdast: m1, hast: h1 } = runPipeline('Hello');
    const built1 = buildBlocks(m1, h1, 'Hello');
    const r1 = renderBlocksWithCache(cacheRef, built1.plan, built1.globalCtx, {});
    const { mdast: m2, hast: h2 } = runPipeline('Hello');
    const built2 = buildBlocks(m2, h2, 'Hello');
    const r2 = renderBlocksWithCache(cacheRef, built2.plan, built2.globalCtx, {});
    expect(r2[0].node).toBe(r1[0].node);
  });
});
