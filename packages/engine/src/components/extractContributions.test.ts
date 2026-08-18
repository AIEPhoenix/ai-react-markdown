import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root as MdastRoot } from 'mdast';
import { extractContributions, type Contribution } from './extractContributions';

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

  test('does NOT count nested footnoteReferences inside footnoteDefinition bodies', () => {
    // Round-14 regression: visit() previously descended into def bodies,
    // counting `[^b]` inside `[^a]:` body as a flow ref → inflated
    // globalNumber('B') so B appeared in the aggregate footer even when
    // no flow text references it, AND inflated getRefsForLabel('A') for
    // any nested `[^a]` self-ref → dead backref pointing at fnref-A-2.
    // SKIP descent on footnoteDefinition fixes both.
    const mdast = parseMdast(`See [^a].\n\n[^a]: body with [^b] nested.\n\n[^b]: never flow-referenced.\n`);
    const out = collect(mdast);
    const refs = out.filter((c) => c.kind === 'ref');
    // Only the flow [^a] counts — the nested [^b] inside [^a]:'s body is skipped.
    expect(refs.length).toBe(1);
    expect(refs[0]).toMatchObject({ refKind: 'footnote', label: 'A' });
    // Both defs are still yielded (defs are at the top level).
    const defs = out.filter((c) => c.kind === 'fnDef');
    expect(defs.map((d) => (d as { label: string }).label).sort()).toEqual(['A', 'B']);
  });

  test('does NOT count a self-recursive nested ref inside its own def body', () => {
    // [^a]: see [^a]. The nested [^a] inside [^a]:'s body is a "self-
    // reference" — counting it would yield 2 refs to A, making the
    // aggregate emit a second backref anchor (fnref-A-2) that no inline
    // sup points at.
    const mdast = parseMdast(`See [^a].\n\n[^a]: recursive: see [^a].\n`);
    const out = collect(mdast);
    const refs = out.filter((c) => c.kind === 'ref' && c.refKind === 'footnote');
    expect(refs.length).toBe(1); // only the flow ref
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
