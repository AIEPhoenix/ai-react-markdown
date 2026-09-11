import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root as MdastRoot } from 'mdast';
import { extractContributions, type Contribution } from './extractContributions';
import { collectDefLabels, createDefLabelScanner } from './collectDefLabels';

function parseMdast(source: string): MdastRoot {
  return unified().use(remarkParse).use(remarkGfm).parse(source) as MdastRoot;
}

function collect(mdast: MdastRoot, phantomFootnoteLabels?: Set<string>): Contribution[] {
  return Array.from(extractContributions(mdast, { phantomFootnoteLabels }));
}

describe('extractContributions', () => {
  test('yields flow-level refs and defs in source order', () => {
    const mdast = parseMdast(`See [^a].\n\n[^a]: body.\n`);
    const out = collect(mdast);
    const refs = out.filter((c) => c.kind === 'ref');
    const defs = out.filter((c) => c.kind === 'fnDef');
    expect(refs.length).toBe(1);
    expect(refs[0]).toMatchObject({ kind: 'ref', refKind: 'footnote', label: 'A' });
    expect(defs.length).toBe(1);
    expect(defs[0]).toMatchObject({ kind: 'fnDef', label: 'A', sourceIdentifier: 'a' });
  });

  test('footnote refs inside a definition body are emitted with nestedIn, not as flow refs', () => {
    // Round-14 regression: visit() once descended into def bodies and counted
    // `[^b]` inside `[^a]:` body as a flow ref, inflating getRefsForLabel so
    // the aggregate emitted a backref to a mark id no inline sup rendered.
    // The other extreme (skipping the body) dropped a footnote that only
    // another footnote references from the coordinated footer, while the
    // standalone footer numbers it after the flow refs. The ref is now
    // emitted flagged with the containing definition's label; the registry
    // numbers it but never counts it as an occurrence.
    const mdast = parseMdast(`See [^a].\n\n[^a]: body with [^b] nested.\n\n[^b]: never flow-referenced.\n`);
    const out = collect(mdast);
    const refs = out.filter((c) => c.kind === 'ref');
    expect(refs).toEqual([
      { kind: 'ref', refKind: 'footnote', label: 'A' },
      { kind: 'ref', refKind: 'footnote', label: 'B', nestedIn: 'A' },
    ]);
    const defs = out.filter((c) => c.kind === 'fnDef');
    expect(defs.map((d) => (d as { label: string }).label).sort()).toEqual(['A', 'B']);
  });

  test('a ref inside a nested definition is attributed to the innermost definition', () => {
    const mdast = parseMdast(`[^a]: outer [^x]\n\n    [^b]: inner [^y]\n\nflow [^a]\n\n[^x]: x\n\n[^y]: y\n`);
    const refs = collect(mdast).filter((c) => c.kind === 'ref');
    expect(refs).toEqual([
      { kind: 'ref', refKind: 'footnote', label: 'X', nestedIn: 'A' },
      { kind: 'ref', refKind: 'footnote', label: 'Y', nestedIn: 'B' },
      { kind: 'ref', refKind: 'footnote', label: 'A' },
    ]);
  });

  test('link definitions nested inside a footnote body are contributed (they are document-wide)', () => {
    // CommonMark resolves `[x]` anywhere in the document against a
    // `[x]: url` written inside a footnote body. The PASS 0 scanner claims
    // the label, so a sibling chunk phantom-injects it; the extractor has
    // to publish the definition or that chunk's placeholder never resolves.
    const mdast = parseMdast(`[^a]: see [x]\n\n    [x]: /url "T"\n\nflow [^a]\n`);
    const out = collect(mdast);
    const linkDefs = out.filter((c) => c.kind === 'linkDef');
    expect(linkDefs).toEqual([{ kind: 'linkDef', label: 'X', url: '/url', title: 'T' }]);
    // The `[x]` inside the body is not recorded: link refs have no registry
    // consumer, so only footnote refs are emitted from a body.
    expect(out.filter((c) => c.kind === 'ref')).toEqual([{ kind: 'ref', refKind: 'footnote', label: 'A' }]);
  });

  test('a footnote definition nested inside another footnote body is contributed', () => {
    // mdast-util-to-hast collects definitions at every depth and renders a
    // `<li>` for the inner one; the harvest keys it by its own id.
    const mdast = parseMdast(`[^a]: outer\n\n    [^b]: inner\n\nx [^a] [^b]\n`);
    const out = collect(mdast);
    const defs = out.filter((c) => c.kind === 'fnDef') as { label: string; sourceIdentifier: string }[];
    expect(defs.map((d) => [d.label, d.sourceIdentifier])).toEqual([
      ['A', 'a'],
      ['B', 'b'],
    ]);
  });

  test('a phantom-injected footnote definition contributes nothing from its body', () => {
    const mdast = parseMdast(`[^x]: body x\n\n    [y]: /y\n`);
    const out = collect(mdast, new Set(['X']));
    expect(out).toEqual([]);
  });

  test('differential: scanner, full collector and extractor claim the same labels for nested definitions', () => {
    // The three label sources must agree exactly. PASS 0 (scanner / full
    // collector) tells sibling chunks which labels to phantom-inject; PASS 1
    // (extractor) publishes the definitions those phantoms resolve against.
    // A label claimed but never contributed leaves a placeholder that never
    // resolves; a label contributed but never claimed is a definition no
    // sibling can reference.
    const sources = [
      '[^a]: see [x]\n\n    [x]: /url\n\nflow [^a] and [x]\n',
      '[^a]: outer\n\n    [^b]: inner\n\n    [y]: /y\n\nx [^a] [^b] [y]\n',
      '> [^q]: quoted\n>\n>     [z]: /z\n\n[z] and [^q]\n',
      '- item\n\n  [^l]: in list\n\n      [w]: /w\n',
      'prose\n\n[^a]: first\n\n    [^b]: second\n\n        [^c]: third\n\n        [deep]: /d\n',
    ];
    const plain = (fn: Iterable<string>, link: Iterable<string>) => ({ fn: [...fn].sort(), link: [...link].sort() });
    for (const source of sources) {
      const scanner = createDefLabelScanner();
      for (let length = 1; length <= source.length; length++) {
        const content = source.slice(0, length);
        const full = collectDefLabels(content);
        const scanned = scanner.scan(content);
        const contributions = collect(parseMdast(content));
        const extracted = plain(
          contributions.filter((c) => c.kind === 'fnDef').map((c) => (c as { label: string }).label),
          contributions.filter((c) => c.kind === 'linkDef').map((c) => (c as { label: string }).label)
        );
        expect(plain(scanned.footnoteLabels, scanned.linkLabels), content).toEqual(
          plain(full.footnoteLabels, full.linkLabels)
        );
        expect(extracted, content).toEqual(plain(full.footnoteLabels, full.linkLabels));
      }
    }
  });

  test('image references inside link text stay flow refs', () => {
    const mdast = parseMdast(`[![alt][img]][lnk]\n\n[img]: /i.png\n\n[lnk]: /l\n`);
    const refs = collect(mdast).filter((c) => c.kind === 'ref');
    expect(refs).toEqual([
      { kind: 'ref', refKind: 'link', label: 'LNK', referenceType: 'full' },
      { kind: 'ref', refKind: 'image', label: 'IMG', referenceType: 'full' },
    ]);
  });

  test('a self-recursive nested ref is flagged with its own label, so it is never counted as a flow ref', () => {
    // [^a]: see [^a]. Counting the nested [^a] as an occurrence would make
    // the aggregate emit a second backref anchor (fnref-A-2) that no inline
    // sup points at.
    const mdast = parseMdast(`See [^a].\n\n[^a]: recursive: see [^a].\n`);
    const refs = collect(mdast).filter((c) => c.kind === 'ref' && c.refKind === 'footnote');
    expect(refs).toEqual([
      { kind: 'ref', refKind: 'footnote', label: 'A' },
      { kind: 'ref', refKind: 'footnote', label: 'A', nestedIn: 'A' },
    ]);
  });

  test('phantom-injected fnDef is skipped (no leak into registry)', () => {
    const mdast = parseMdast(`[^x]: body x\n`);
    const out = collect(mdast, new Set(['X']));
    const defs = out.filter((c) => c.kind === 'fnDef');
    expect(defs.length).toBe(0);
  });

  test('linkReference and imageReference flow refs preserve referenceType', () => {
    const mdast = parseMdast(`[click][lbl]\n\n![alt][lbl]\n\n[lbl]: https://ex.com\n`);
    const out = collect(mdast);
    const linkRef = out.find((c) => c.kind === 'ref' && c.refKind === 'link');
    const imgRef = out.find((c) => c.kind === 'ref' && c.refKind === 'image');
    expect(linkRef).toMatchObject({ refKind: 'link', label: 'LBL', referenceType: 'full' });
    expect(imgRef).toMatchObject({ refKind: 'image', label: 'LBL', referenceType: 'full' });
  });

  test('linkDef is yielded with url and title', () => {
    const mdast = parseMdast(`[lbl]: https://ex.com "Title"\n`);
    const out = collect(mdast);
    const linkDef = out.find((c) => c.kind === 'linkDef');
    expect(linkDef).toMatchObject({ kind: 'linkDef', label: 'LBL', url: 'https://ex.com', title: 'Title' });
  });

  describe('linkDef urls are emitted RAW (v2.4.2 review P1-4)', () => {
    // The render-time gate (`sanitizeCrossChunkUrl`) is the single point of
    // enforcement: it must see the raw URL to tell a protocol-blocked
    // destination (attribute absent) from a legally empty one (`href=""`),
    // and to apply a rewriting urlTransform exactly once, like standalone.
    test('a javascript: definition reaches the registry untouched', () => {
      const mdast = parseMdast(`[evil]: javascript:alert(1)\n`);
      const linkDef = collect(mdast).find((c) => c.kind === 'linkDef');
      expect((linkDef as { url: string }).url).toBe('javascript:alert(1)');
    });
    test('an empty destination stays empty', () => {
      const mdast = parseMdast(`[e]: <>\n`);
      const linkDef = collect(mdast).find((c) => c.kind === 'linkDef');
      expect((linkDef as { url: string }).url).toBe('');
    });
  });
});
