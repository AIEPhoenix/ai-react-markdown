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
import rehypeRaw from '@ai-markdown/rehype-raw';
import { buildCrossChunkHandlers } from '@ai-react-markdown/engine';
import rehypeSanitize from 'rehype-sanitize';
import { VFile } from 'vfile';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { sanitizeSchema } from '@ai-react-markdown/engine';
import { rehypeRebaseHashLinks } from '@ai-react-markdown/engine';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildBlocks,
  computeBlockFingerprint,
  computeHtmlBlockDigestWithExtent,
  createCache,
  isFootnoteSection,
  hasMdastSource,
  renderBlocksWithCache,
  type Cache,
  type PostOptions,
} from './blockMemo';
import { createRegistry, type Registry } from '@ai-react-markdown/engine';
import { visit } from 'unist-util-visit';

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
  test('2026-08-20 A1: the swallowed extent reaches everything the container actually swallowed', () => {
    // `maxEnd` bounds the source range a raw-HTML container is held
    // responsible for, and every use of it is unsafe in the SHORT direction:
    // too small and a swallowed reference falls outside the taint test, so a
    // definition edit outside the container leaves a stale href in the cache.
    // Two independent sources feed it — the container's own hast end offset
    // (rehype-raw reparses the raw string and closes the element wherever
    // parse5 does, which is past the swallowed blocks) and the max end over
    // its hast descendants. Either one alone covers every shape below; the
    // pin is here so an upgrade that changes how positions survive the
    // reparse fails loudly instead of silently under-tainting.
    const openers = [
      '<details>',
      '<details>\n<summary>s</summary>',
      '<div>',
      '<div class="a">',
      '<section>',
      '<blockquote>',
      '<span>',
      '<table>',
      '<table>\n<tbody>',
      '<table>\n<tr><td>c</td></tr>',
      '<ul>',
      '<ul>\n<li>i</li>',
      '<dl>',
      '<p>',
      '<div>\n<div>\n<div>',
      '<select>',
      '<button>',
      '<a href="#z">',
      '<td>',
      '<tr>',
      '<li>',
      '<summary>',
      '<div><!-- c -->',
      '<div a="b>c">',
      '<h1>',
      '<pre>',
      '<code>',
    ];
    const tails = [
      'See [x].',
      'para one\n\npara two [x]\n\npara three',
      '- a\n- b [x]\n\n> quote [x]\n',
      '| h |\n| - |\n| [x] |\n',
      '```\ncode [x]\n```\n\ntext [x]',
      '![y][x]\n\n### head [x]\n\nfinal',
    ];
    const tooShort: string[] = [];
    const inert: string[] = [];
    let checked = 0;
    for (const opener of openers) {
      for (const tail of tails) {
        const md = `[x]: https://a.example\n\n${opener}\n\n${tail}\n`;
        const { mdast, hast } = runPipeline(md);
        const containerIdx = mdast.children.findIndex((c) => c.type === 'html');
        if (containerIdx < 0) continue;
        const container = mdast.children[containerIdx];
        const ownEnd = container.position!.end!.offset!;
        const built = buildBlocks(mdast, hast, md);
        // Anything after the container that no longer has a top-level block
        // of its own was swallowed by it.
        const topStarts = new Set<number>();
        for (const item of built.plan) if (item.kind === 'block') topStarts.add(item.info.startOffset);
        let trueEnd = ownEnd;
        for (const node of mdast.children.slice(containerIdx + 1)) {
          const start = node.position?.start?.offset;
          const end = node.position?.end?.offset;
          if (start === undefined || end === undefined) continue;
          // Definitions render nothing of their own, so their absence from
          // the plan says nothing about who swallowed them.
          if (node.type === 'definition' || node.type === 'footnoteDefinition') continue;
          if (!topStarts.has(start)) trueEnd = Math.max(trueEnd, end);
        }
        const el = hast.children.find(
          (c): c is HastElement =>
            c.type === 'element' && c.position?.start?.offset === container.position!.start!.offset
        );
        // Sanitize drops some openers outright (`<figure>`, `<svg>`); nothing
        // to hold responsible then.
        if (el === undefined) continue;
        checked += 1;
        const { maxEnd } = computeHtmlBlockDigestWithExtent(el, md, ownEnd);
        const label = `${JSON.stringify(opener)} + ${JSON.stringify(tail.slice(0, 16))}`;
        if (maxEnd < trueEnd) tooShort.push(`${label}: maxEnd=${maxEnd} < ${trueEnd}`);
        if (trueEnd > ownEnd && maxEnd <= ownEnd) inert.push(`${label}: swallowed, extent empty`);
      }
    }
    expect({ tooShort, inert }).toEqual({ tooShort: [], inert: [] });
    expect(checked).toBeGreaterThan(100);
  });

  test('2026-08-20 A1: a definition BEFORE an unclosed container still updates what it swallowed', () => {
    // The definition sits outside `[ownEnd, maxEnd)`, so the extent hash
    // cannot see the edit — only the mdast taint test can, by noticing the
    // swallowed reference and switching the block's key to `globalCtx`.
    for (const opener of ['<details>', '<div>', '<section>', '<table>', '<ul>', '<p>', '<blockquote>']) {
      for (const body of ['See [x].', '![y][x]', '[x]']) {
        const doc = (url: string) => `[x]: ${url}\n\nintro\n\n${opener}\n\n${body}\n`;
        const cacheRef = { current: createCache() };
        const first = frame(doc('https://a.example'), cacheRef);
        const second = frame(doc('https://b.example'), cacheRef);
        const fresh = frame(doc('https://b.example'), { current: createCache() });
        const label = `${opener} + ${body}`;
        expect({ label, html: renderToStaticMarkup(createElement(Fragment, null, ...second.rendered)) }).toEqual({
          label,
          html: renderToStaticMarkup(createElement(Fragment, null, ...fresh.rendered)),
        });
        // Guard against a vacuous case where both frames render the same.
        expect(renderToStaticMarkup(createElement(Fragment, null, ...first.rendered))).not.toBe(
          renderToStaticMarkup(createElement(Fragment, null, ...fresh.rendered))
        );
      }
    }
  });

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

describe('buildBlocks — half-built mdast position (v2.4.1 review)', () => {
  test('a block whose mdast node lacks an end offset is rendered inline, not dropped', () => {
    const md = 'Hello\n\nWorld';
    const { mdast, hast } = runPipeline(md);
    // A third-party remark plugin that emits `position.end` without offset.
    const second = mdast.children[1]!;
    (second.position as { end: { offset?: number } }).end = { ...second.position!.end, offset: undefined };
    const built = buildBlocks(mdast, hast, md);
    const kept = built.plan.filter((p) => p.kind === 'inline' && (p.el as HastElement).tagName === 'p');
    expect(kept).toHaveLength(1);
    expect(built.blocks).toHaveLength(1);
    // The uncached item still reaches the render list.
    const cacheRef = { current: createCache() };
    const all = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, emptyPostOptions);
    expect(all).toHaveLength(built.plan.length);
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

  test('inline output stays equivalent while block nodes retain cache identity', () => {
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
    // Plain text can be returned directly. Verify emitted bytes, not an
    // incidental Fragment allocation around each whitespace separator.
    for (const i of inlineIndices) {
      const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));
      expect(html(r2[i].node)).toBe(html(r1[i].node));
      expect(html(r2[i].node)).toBe('\n');
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

describe('buildBlocks per-block taintLabels (v6)', () => {
  test('records footnoteRef labels per block', () => {
    // Refs only parse as footnoteReference when a matching definition exists;
    // include definitions so the paragraph block contains real ref nodes.
    const source = 'See [^x] and [^y].\n\n[^x]: x\n\n[^y]: y';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);

    const blk = built.blocks[0];
    expect(blk.hasReference).toBe(true);
    expect(blk.taintLabels).toBeDefined();
    expect(blk.taintLabels!.footnoteRefLabels.sort()).toEqual(['X', 'Y']);
  });

  test('records linkRef + imageRef + footnoteDef separately', () => {
    // Link/image refs need matching definitions to parse as reference nodes.
    const source = '[click][a] and ![alt][b].\n\n[a]: /a\n\n[b]: /b\n\n[^c]: def text';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    // First TAINT block: linkRef + imageRef
    const para = built.blocks.find((b) => b.taintLabels?.linkRefLabels.length);
    expect(para?.taintLabels?.linkRefLabels).toEqual(['A']);
    expect(para?.taintLabels?.imageRefLabels).toEqual(['B']);
    // The footnoteDefinition lives in synthetic footer typically; here treat as block-level
    // (synthetic is a separate plan item; this test only verifies non-synthetic blocks).
  });

  test('2026-08-19 review P2-4: chunk-local footnote occurrence state is part of the taint footprint', () => {
    // block1 `a[^w] b[^x]`, block2 `c[^x]`: block2's raw and registry answers
    // do not change when block1's `[^x]` becomes `[^w]` in place, but the
    // engine bakes localOccurrence(x)=2 vs 1 into block2's placeholder — the
    // fingerprint must see the prefix change.
    const build = (source: string) => {
      const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast) as HastRoot;
      return buildBlocks(mdast as MdastRoot, hast, source);
    };
    const before = build('a[^w] b[^x]\n\nc[^x]\n\n[^w]: w\n\n[^x]: x');
    const after = build('a[^w] b[^w]\n\nc[^x]\n\n[^w]: w\n\n[^x]: x');
    const b2Before = before.blocks[1];
    const b2After = after.blocks[1];
    expect(b2Before.raw).toBe(b2After.raw);
    expect(b2Before.taintLabels!.footnoteRefLabels).toEqual(['X']);
    expect(b2Before.taintLabels!.footnoteRefLocalCtx).toBe(JSON.stringify([['X', 1, 1]]));
    expect(b2After.taintLabels!.footnoteRefLocalCtx).toBe(JSON.stringify([['X', 0, 1]]));
    // …and the fingerprint differs even against an identical registry.
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk-A');
    reg.contributeChunkData(sym, {
      refs: [
        { label: 'W', kind: 'footnote' },
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    expect(computeBlockFingerprint(b2Before.taintLabels!, reg, sym, 'doc-')).not.toBe(
      computeBlockFingerprint(b2After.taintLabels!, reg, sym, 'doc-')
    );
    // Blocks without refs carry no local ctx.
    expect(build('plain\n\n[a]: /u\n\n[x][a]').blocks[0].taintLabels).toBeUndefined();
    // A ref inside a (list-nested) footnote definition is footer-rendered
    // AFTER every body ref — it must not shift a later body block's count.
    const nested = build('- item\n\n  [^x]: def with [^y] ref\n\nlater [^y]\n\n[^y]: y');
    const later = nested.blocks.find((b) => b.raw.startsWith('later'))!;
    expect(later.taintLabels!.footnoteRefLocalCtx).toBe(JSON.stringify([['Y', 0, 1]])); // rank 1: the nested [^x] definition took rank 0
  });

  test('2026-08-19 review r2 P2-8/P2-9: an unclosed raw-HTML container reads its taint from the swallowed subtree', () => {
    // rehype-raw reparents the following siblings into an unclosed
    // `<details>`; the container's own mdast node is an empty `html` node,
    // so every mdast-derived taint fact used to come out empty and the block
    // fell back to the un-fingerprinted cache key.
    const build = (source: string) => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast, source) as HastRoot;
      return buildBlocks(mdast as MdastRoot, hast, source);
    };
    const src = 'a[^w] b[^x]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n';
    const built = build(src);
    const container = built.blocks.find((b) => b.raw.startsWith('<details>'));
    expect(container, 'the unclosed container is a cached block').toBeDefined();
    // It now declares itself tainted and carries the labels + the local
    // occurrence values BAKED into the swallowed placeholders/marks.
    expect(container!.hasReference).toBe(true);
    // …and it reports that the synthesized footnote section landed inside.
    expect(container!.containsFootnoteSection).toBe(true);
    // The top-level plan therefore has NO synthetic item — which is exactly
    // why coordinated mode has to strip the section from this block instead.
    expect(built.synthetic).toBeUndefined();
    // Why `hasReference` is the whole point: an equal-length edit BEFORE the
    // container changes a footnote number baked INSIDE it (`b[^x]` → `b[^w]`
    // makes the swallowed `c[^x]` x's 1st ref, not its 2nd), while every
    // legacy key component of the container stays identical.
    const after = build('a[^w] b[^w]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n');
    const afterContainer = after.blocks.find((b) => b.raw.startsWith('<details>'))!;
    expect(afterContainer.raw).toBe(container!.raw);
    expect(afterContainer.startOffset).toBe(container!.startOffset);
    expect(afterContainer.hastDigest).toBe(container!.hastDigest);
    // With `hasReference` false (the old behaviour) the cache key was
    // `(raw, occ, '', position, hastDigest)` — identical across both frames,
    // a guaranteed stale hit. Now the block is tainted, so its ctx is the
    // document-wide globalCtx in standalone mode…
    expect(afterContainer.hasReference).toBe(true);
    expect(after.globalCtx).not.toBe(built.globalCtx);
    // …and in coordinated mode the swallowed `footnote-sup` placeholders
    // contribute their baked localOccurrence to the fingerprint as well
    // (scanSwallowedSubtree); standalone marks carry no such props, which is
    // why the flag alone has to carry that case.
    expect(container!.taintLabels).toBeDefined();

    // A standalone LINK reference inside the container renders as a plain
    // `<a href>` — indistinguishable from an inline link in the hast — so the
    // subtree scan cannot see it. When its definition sits BEFORE the
    // container it is also outside the digest's swallowed extent, and every
    // cache-key component stayed equal while the rendered href changed. The
    // mdast range test (taint offsets inside `[ownEnd, maxEnd)`) covers it.
    const linkBefore = build('[r]: /aaa\n\n<details>\n\nsee [u][r]\n');
    const linkAfter = build('[r]: /bbb\n\n<details>\n\nsee [u][r]\n');
    const lb = linkBefore.blocks.find((b) => b.raw.startsWith('<details'))!;
    const la = linkAfter.blocks.find((b) => b.raw.startsWith('<details'))!;
    expect(lb.hastDigest).toBe(la.hastDigest); // the edit is outside the swallowed extent
    expect(lb.hasReference).toBe(true); // …so only the taint flag separates the frames
    expect(linkBefore.globalCtx).not.toBe(linkAfter.globalCtx);
  });

  test('2026-08-20 B2: a phantom label takes no rank, so a phantom→real flip invalidates the blocks it renumbers', () => {
    // `localNumber` is `state.footnoteOrder.indexOf(id) + 1`, and phantom
    // labels never enter footnoteOrder — the handlers return early for both
    // their definition and their references. The cache's rank counted them
    // anyway, so when a cross-chunk label's definition arrived locally and
    // every LATER footnote was renumbered, the rank did not move: same raw,
    // same position, same key, and the cached superscript kept reading 1
    // under a footer numbering it 2.
    const buildWithPhantoms = (source: string, phantoms: string[]) => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, {
          allowDangerousHtml: true,
          handlers: buildCrossChunkHandlers(),
          phantomFootnoteLabels: new Set(phantoms),
          preserveOrphan: false,
          documentId: 'doc',
        } as never)
        .use(rehypeRaw);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast, source) as HastRoot;
      return {
        built: buildBlocks(mdast as MdastRoot, hast, source, { phantomFootnoteLabels: new Set(phantoms) }),
        hast,
      };
    };
    const bakedNumbers = (hast: HastRoot) => {
      const out: Array<[string, unknown]> = [];
      visit(hast, 'element', (el: HastElement) => {
        if (el.tagName === 'footnote-sup') out.push([String(el.properties?.label), el.properties?.localNumber]);
      });
      return out;
    };

    // Frame 1: `[^A]` is defined by ANOTHER chunk, so the pipeline injects a
    // phantom definition for it. Frame 2: A's real definition has arrived.
    const before = buildWithPhantoms('see [^A]\n\nsee [^B]\n\n[^B]: bee\n\n[^A]: __aimd_sentinel_fn__\n', ['A']);
    const after = buildWithPhantoms('see [^A]\n\nsee [^B]\n\n[^B]: bee\n\n[^A]: ay\n', []);

    // The premise: B really is renumbered, and nothing else about its block
    // moved — without both halves the test proves nothing.
    expect(bakedNumbers(before.hast)).toEqual([
      ['a', undefined],
      ['b', '1'],
    ]);
    expect(bakedNumbers(after.hast)).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
    const blockBefore = before.built.blocks.find((b) => b.raw === 'see [^B]')!;
    const blockAfter = after.built.blocks.find((b) => b.raw === 'see [^B]')!;
    expect(blockAfter.startOffset).toBe(blockBefore.startOffset);
    expect(blockAfter.raw).toBe(blockBefore.raw);

    // …so the local ctx is the only thing that can separate the two frames.
    expect(blockBefore.taintLabels?.footnoteRefLocalCtx).not.toBe(blockAfter.taintLabels?.footnoteRefLocalCtx);

    // And it reaches the fingerprint, which is what the cache keys on.
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');
    expect(computeBlockFingerprint(blockBefore.taintLabels!, reg, sym, '')).not.toBe(
      computeBlockFingerprint(blockAfter.taintLabels!, reg, sym, '')
    );
  });

  test('2026-08-19 review r2 P2-8, coordinated leg: swallowed placeholders carry their baked occurrence into the fingerprint', () => {
    // The standalone leg is covered above; this is the leg the whole P2-8
    // fix exists for — a coordinated pipeline bakes `localOccurrence` into
    // `footnote-sup` placeholders, and an unclosed container swallows them.
    const buildCoordinated = (source: string) => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, {
          allowDangerousHtml: true,
          handlers: buildCrossChunkHandlers(),
          // The handler reads these off `state.options`.
          phantomFootnoteLabels: new Set<string>(),
          preserveOrphan: false,
          documentId: 'doc',
        } as never)
        .use(rehypeRaw);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast, source) as HastRoot;
      return buildBlocks(mdast as MdastRoot, hast, source);
    };
    // `b[^x]` → `b[^w]` is equal-length and sits BEFORE the container, so the
    // container's raw/position/digest are untouched — but it changes the
    // swallowed `c[^x]` from x's 2nd occurrence to its 1st.
    const before = buildCoordinated('a[^w] b[^x]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n');
    const after = buildCoordinated('a[^w] b[^w]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n');
    const cb = before.blocks.find((b) => b.raw.startsWith('<details'))!;
    const ca = after.blocks.find((b) => b.raw.startsWith('<details'))!;
    expect(cb.hastDigest).toBe(ca.hastDigest);
    expect(cb.startOffset).toBe(ca.startOffset);
    // The placeholder scan is what separates the two frames here.
    expect(cb.taintLabels?.footnoteRefLabels).toContain('X');
    expect(cb.taintLabels?.footnoteRefLocalCtx).toBeDefined();
    expect(cb.taintLabels!.footnoteRefLocalCtx).not.toBe(ca.taintLabels!.footnoteRefLocalCtx);
    // …and it reaches the fingerprint, which is what the cache actually keys on.
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    expect(computeBlockFingerprint(cb.taintLabels!, reg, sym, 'doc-')).not.toBe(
      computeBlockFingerprint(ca.taintLabels!, reg, sym, 'doc-')
    );
  });

  test('non-TAINT block has taintLabels undefined', () => {
    const source = 'Just plain text.';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    expect(built.blocks[0].hasReference).toBe(false);
    expect(built.blocks[0].taintLabels).toBeUndefined();
  });
});

describe('computeBlockFingerprint (v6)', () => {
  test('empty taintLabels yields just clobberPrefix', () => {
    const reg = createRegistry();
    const sym = Symbol('chunk');
    const fp = computeBlockFingerprint(
      { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: [] },
      reg,
      sym,
      'doc-user-content-'
    );
    expect(fp).toBe('doc-user-content-');
  });

  test('footnote ref label encoded with globalNumber', () => {
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk-A');
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    const fp = computeBlockFingerprint(
      { footnoteRefLabels: ['X'], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: [] },
      reg,
      sym,
      'doc-user-content-'
    );
    expect(fp).toBe('doc-user-content-|fn:X=1');
  });

  test('v2.4.1 review: a `|` inside url/title cannot collide with the part separator', () => {
    const taint = { footnoteRefLabels: [], linkRefLabels: ['X'], imageRefLabels: [], footnoteDefLabels: [] };
    const fpFor = (url: string, title: string | undefined): string => {
      const reg = createRegistry();
      const sym = reg.allocateSymbol('chunk-A');
      reg.contributeChunkData(sym, {
        refs: [],
        defs: new Map(),
        linkDefs: new Map([['X', { identifier: 'X', url, title }]]),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(['X']),
      });
      return computeBlockFingerprint(taint, reg, sym, 'doc-');
    };
    expect(fpFor('a|b', undefined)).not.toBe(fpFor('a', 'b'));
    expect(fpFor('a', 'b')).toBe(fpFor('a', 'b'));
  });

  test('canonical change in registry → different fingerprint', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('chunk-A');
    const b = reg.allocateSymbol('chunk-B');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map([['X', { identifier: 'X', contentSource: 'A' }]]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    const taint = { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: ['X'] };
    const fpAFirst = computeBlockFingerprint(taint, reg, a, 'doc-');
    // A is canonical, fingerprint encodes 1
    expect(fpAFirst).toContain('fd:X=1');
    const fpBFirst = computeBlockFingerprint(taint, reg, b, 'doc-');
    // B is non-canonical, fingerprint encodes 0
    expect(fpBFirst).toContain('fd:X=0');
    expect(fpAFirst).not.toBe(fpBFirst);
  });

  test('refCount included in footnoteDef fingerprint', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [
        { label: 'X', kind: 'footnote' },
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    const fp = computeBlockFingerprint(
      { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: ['X'] },
      reg,
      a,
      'doc-'
    );
    expect(fp).toContain('/2');
  });

  test('image title change invalidates fingerprint (v6.1 blocker 2 fix)', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const taint = { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: ['X'], footnoteDefLabels: [] };
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map([['X', { identifier: 'X', url: 'https://x.png', title: 'first' }]]),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(['X']),
    });
    const fp1 = computeBlockFingerprint(taint, reg, a, 'doc-');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map([['X', { identifier: 'X', url: 'https://x.png', title: 'second' }]]),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(['X']),
    });
    const fp2 = computeBlockFingerprint(taint, reg, a, 'doc-');
    expect(fp1).not.toBe(fp2); // title delta must invalidate cache
  });

  test('cross-chunk refCount aggregation (v6.1 spec clarification)', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    // A defines X but has no refs to X locally
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map([['X', { identifier: 'X', contentSource: 'def in A' }]]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    // Initial fingerprint for A's def block: refCount 0
    const taint = { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: ['X'] };
    const fpBefore = computeBlockFingerprint(taint, reg, a, 'doc-');
    expect(fpBefore).toContain('fd:X=1/0');
    // B contributes a ref to X (cross-chunk). registry.getRefsForLabel('X') should rise to 1.
    reg.contributeChunkData(b, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    const fpAfter = computeBlockFingerprint(taint, reg, a, 'doc-');
    expect(fpAfter).toContain('fd:X=1/1');
    expect(fpBefore).not.toBe(fpAfter); // A's def block must invalidate
  });
});

describe('renderBlocksWithCache fingerprint cache (v6)', () => {
  function makeOpts(registry: Registry | undefined, thisChunkSym?: symbol, clobberPrefix = 'doc-'): PostOptions {
    return Object.freeze({
      components: {},
      urlTransform: (u: string) => u,
      allowedElements: undefined,
      disallowedElements: undefined,
      allowElement: undefined,
      skipHtml: false,
      unwrapDisallowed: false,
      registry,
      thisChunkSymbol: thisChunkSym,
      clobberPrefix,
    });
  }

  test('TAINT block with stable fingerprint hits cache', () => {
    // Footnote definition included in source so remark-gfm parses [^x] as a footnoteReference
    // (a bare `See [^x].` without a definition is left as plain text).
    const source = 'See [^x].\n\n[^x]: hello';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });

    const cacheRef = { current: createCache() };
    const opts = makeOpts(reg, sym);
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e1 = cacheRef.current.blocks.get('See [^x].')?.[0];
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e2 = cacheRef.current.blocks.get('See [^x].')?.[0];
    expect(e1?.node).toBe(e2?.node); // same ReactNode → cache hit
  });

  test('TAINT block with changed fingerprint misses cache', () => {
    // Footnote definition included so [^x] parses as a footnoteReference.
    const source = 'See [^x].\n\n[^x]: hello';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');

    const cacheRef = { current: createCache() };
    const opts = makeOpts(reg, sym);
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e1 = cacheRef.current.blocks.get('See [^x].')?.[0];

    // Mutate registry: add the ref so globalNumber returns 1 (was null before)
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });

    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e2 = cacheRef.current.blocks.get('See [^x].')?.[0];
    expect(e1?.node).not.toBe(e2?.node); // different ReactNode → cache miss → re-rendered
  });

  test('standalone (no registry) falls back to globalCtx, byte-equiv to pre-v6', () => {
    const source = 'See [^x].\n\n[^x]: hello';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);

    const cacheRef = { current: createCache() };
    const opts = makeOpts(undefined); // no registry → fallback path
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e1 = cacheRef.current.blocks.get('See [^x].')?.[0];
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e2 = cacheRef.current.blocks.get('See [^x].')?.[0];
    expect(e1?.node).toBe(e2?.node); // globalCtx unchanged → cache hit
  });
});

// ─── renderHastSubtree re-entry safety (urlTransform convergence) ──────────

describe('renderBlocksWithCache — hast re-entry safety', () => {
  // Renders without a re-parse (registry version bump, G3 cache flush,
  // urlTransform prop swap) re-enter the SAME memoized hast elements. The
  // visit transform must therefore apply urlTransform CONVERGENTLY — always
  // recomputed from the stashed original (`element.data.originalUrls`), so
  // a non-idempotent urlTransform is never applied on top of its own
  // previous output and a swapped transform never sees the old one's.
  test('cache-miss re-render on the same hast applies urlTransform exactly once', () => {
    const content = '[link](https://example.com/a)';
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);
    const opts: PostOptions = { urlTransform: (u: string) => `https://proxy.test/?u=${encodeURIComponent(u)}` };

    const cacheRef = { current: createCache() };
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    // Simulate a G3 flush: fresh cache, same plan/hast, same options.
    cacheRef.current = createCache();
    const r2 = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);

    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        r2.map((r) => r.node)
      )
    );
    expect(html).toContain('https://proxy.test/?u=https%3A%2F%2Fexample.com%2Fa');
    expect(html).not.toContain('u%3Dhttps'); // double-wrapped proxy URL

    // Convergence contract: the transformed value lands in `properties`, but
    // the ORIGINAL href stays recoverable in the data stash — every future
    // pass recomputes from it, so re-entry can never compound the transform.
    const blockItem = built.plan.find((p) => p.kind === 'block');
    const para = blockItem && 'el' in blockItem ? (blockItem.el as HastElement) : undefined;
    const anchor = para?.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'a');
    const stash = (anchor?.data as { originalUrls?: Record<string, unknown> } | undefined)?.originalUrls;
    expect(stash?.href).toBe('https://example.com/a');
    expect(anchor?.properties.href).toBe('https://proxy.test/?u=https%3A%2F%2Fexample.com%2Fa');
  });

  test('swapping urlTransform between renders applies only the new transform', () => {
    const content = '[link](https://example.com/a)';
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);

    const cacheRef = { current: createCache() };
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {
      urlTransform: (u: string) => `${u}?v=old`,
    });
    // urlTransform is a G3 dep: swapping it flushes the cache, then the same
    // hast re-renders. Only the NEW transform may appear in the output.
    cacheRef.current = createCache();
    const r2 = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {
      urlTransform: (u: string) => `${u}?v=new`,
    });

    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        r2.map((r) => r.node)
      )
    );
    expect(html).toContain('https://example.com/a?v=new');
    expect(html).not.toContain('v=old');
  });

  test('identity transform stashes nothing, and a later real transform stays convergent', () => {
    const content = '[link](https://example.com/a)';
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);

    // First render under the DEFAULT transform (identity for safe URLs).
    const cacheRef = { current: createCache() };
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {});

    const blockItem = built.plan.find((p) => p.kind === 'block');
    const para = blockItem && 'el' in blockItem ? (blockItem.el as HastElement) : undefined;
    const anchor = para?.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'a');
    // Nothing changed → nothing archived, no per-element allocation. These
    // nodes are retained by the block-memo cache, so a stash here would be
    // permanent dead weight on every URL-bearing element.
    expect((anchor?.data as { originalUrls?: Record<string, unknown> } | undefined)?.originalUrls).toBeUndefined();
    expect(anchor?.properties.href).toBe('https://example.com/a');

    // No stash ⇔ the property still holds the original, so a later pass
    // with a REAL transform (G3 flush after a urlTransform prop swap) reads
    // it directly and archives it only then.
    cacheRef.current = createCache();
    const r2 = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {
      urlTransform: (u: string) => `${u}?v=new`,
    });
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        r2.map((r) => r.node)
      )
    );
    expect(html).toContain('https://example.com/a?v=new');
    const stash = (anchor?.data as { originalUrls?: Record<string, unknown> } | undefined)?.originalUrls;
    expect(stash?.href).toBe('https://example.com/a');
  });
});

describe('raw-HTML swallow invalidation (hastDigest)', () => {
  // rehype-raw's HTML parsing algorithm reparents every FOLLOWING top-level
  // sibling into an unclosed container tag. The container's mdast identity
  // (raw, position, ctx) is byte-identical across those frames, so before
  // hastDigest the first swallowed snapshot became a permanent cache hit —
  // trailing content froze inside the container and the synthetic footnote
  // section ended up duplicated (stale copy trapped in <details> + fresh
  // top-level copy) once the close tag arrived.

  const DOC = [
    '一段话[^1]。',
    '',
    '[^1]: 脚注内容。',
    '',
    '<details>',
    '<summary>标题</summary>',
    '',
    '内部段落',
    '',
    '</details>',
    '',
    '尾部段落',
    '',
  ].join('\n');

  function detailsNodeOf(built: ReturnType<typeof buildBlocks>, all: { node: ReactNode }[]) {
    const idx = built.plan.findIndex((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'details');
    return idx === -1 ? undefined : { item: built.plan[idx], node: all[idx].node };
  }

  function rawFrame(content: string, cacheRef: { current: Cache }) {
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);
    const all = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, emptyPostOptions);
    return { built, all };
  }

  test('unclosed <details> swallowing the footnote section re-renders when the extent changes', () => {
    const cacheRef = { current: createCache() };
    // F1: cut right after the swallowed 内部段落 starts — details contains
    // summary + partial paragraph + the swallowed footnote section.
    const f1 = rawFrame(DOC.slice(0, DOC.indexOf('内部段落') + 3), cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    expect(d1).toBeDefined();
    const html1 = renderToStaticMarkup(createElement(Fragment, null, d1!.node));
    expect(html1).toContain('data-footnotes');

    // F2: more bytes, still unclosed — digest must differ, node must be fresh.
    const f2 = rawFrame(DOC.slice(0, DOC.indexOf('</details>')), cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    expect(d2).toBeDefined();
    expect(d2!.node).not.toBe(d1!.node);

    // F3: fully closed document — the details block must re-render WITHOUT
    // the swallowed section, and the section must appear exactly once at
    // the document level.
    const f3 = rawFrame(DOC, cacheRef);
    const d3 = detailsNodeOf(f3.built, f3.all);
    expect(d3).toBeDefined();
    expect(d3!.node).not.toBe(d1!.node);
    const html3 = renderToStaticMarkup(createElement(Fragment, null, d3!.node));
    expect(html3).not.toContain('data-footnotes');
    const fullHtml = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        f3.all.map((r, i) => createElement(Fragment, { key: i }, r.node))
      )
    );
    expect(fullHtml.split('data-footnotes').length - 1).toBe(1);
  });

  test('v2.4.2 review P2-1: an equal-length replacement of swallowed content is a cache miss', () => {
    const cacheRef = { current: createCache() };
    const a = '<details>\n<summary>t</summary>\n\nAnswer: 42\n';
    const b = '<details>\n<summary>t</summary>\n\nAnswer: 43\n';
    const f1 = rawFrame(a, cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    expect(renderToStaticMarkup(createElement(Fragment, null, d1!.node))).toContain('Answer: 42');
    // Same byte length, same node count, same maxEnd — only the swallowed
    // text differs. Before the source hash this was a stale cache hit.
    const f2 = rawFrame(b, cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    expect(d2!.node).not.toBe(d1!.node);
    expect(renderToStaticMarkup(createElement(Fragment, null, d2!.node))).toContain('Answer: 43');
  });

  test('degenerate corner: swallowed section leaves no maxEnd trace (positions point backwards)', () => {
    // <details> closes with NOTHING inside except the summary, and the
    // footnote defs live BEFORE it — the swallowed section's positioned
    // descendants all end before the details' own end offset, so maxEnd
    // alone cannot distinguish the swallowed frame from the closed frame.
    // The descendant-count / dataFootnotes components must catch it.
    //
    // The blank line before </details> is load-bearing: it makes the close
    // tag its OWN html block, so the open-tag block's `raw` is byte-identical
    // between the unclosed and closed frames (matching the streaming shape
    // of the original bug). Without it the close tag joins the open block
    // and plain raw-invalidation would mask what this test targets.
    const doc = ['引用[^a]。', '', '[^a]: 定义。', '', '<details>', '<summary>x</summary>', '', '</details>', ''].join(
      '\n'
    );
    const cacheRef = { current: createCache() };
    // Unclosed frame: cut just before </details> — section gets swallowed.
    const f1 = rawFrame(doc.slice(0, doc.indexOf('</details>')), cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    expect(d1).toBeDefined();
    expect(renderToStaticMarkup(createElement(Fragment, null, d1!.node))).toContain('data-footnotes');

    const f2 = rawFrame(doc, cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    expect(d2).toBeDefined();
    expect(d2!.node).not.toBe(d1!.node);
    expect(renderToStaticMarkup(createElement(Fragment, null, d2!.node))).not.toContain('data-footnotes');
  });

  test('stable closed raw-HTML block stays a cache hit across appends elsewhere', () => {
    const closed = '<details>\n<summary>x</summary>\n\n体\n\n</details>\n\n尾巴';
    const cacheRef = { current: createCache() };
    const f1 = rawFrame(closed, cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    const f2 = rawFrame(closed + '继续追加的文字', cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    // Subtree unchanged → digest unchanged → referential cache hit preserved.
    expect(d2!.node).toBe(d1!.node);
  });

  test('markdown-native blocks skip the digest walk; raw-HTML blocks get one', () => {
    const { mdast, hast } = runPipeline('段落文字\n\n<details>\n<summary>x</summary>\n</details>\n');
    const built = buildBlocks(mdast, hast, '段落文字\n\n<details>\n<summary>x</summary>\n</details>\n');
    const para = built.plan.find((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'p');
    const details = built.plan.find((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'details');
    expect(para && para.kind === 'block' ? para.info.hastDigest : 'missing').toBeUndefined();
    expect(details && details.kind === 'block' ? details.info.hastDigest : undefined).toMatch(
      /^\d+:\d+:[01]:[0-9a-z]+$/
    );
  });

  test('range-fallback blocks (split raw HTML) also get a digest', () => {
    // Leading spaces make rehype-raw emit the <div> as a hast sibling whose
    // offset sits INSIDE the mdast html node's range — resolved via the
    // range-containment fallback, which must also opt into the digest.
    const doc = '   <div>内容</div>\n\n尾部\n';
    const { mdast, hast } = runPipeline(doc);
    const built = buildBlocks(mdast, hast, doc);
    const div = built.plan.find((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'div');
    expect(div && div.kind === 'block' ? div.info.hastDigest : undefined).toMatch(/^\d+:\d+:[01]:[0-9a-z]+$/);
  });
});
