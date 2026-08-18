import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { buildCrossChunkHandlers } from './customMdastHandlers';
import { buildPhantomSuffix } from './remarkInjectPhantomDefs';
import { sanitizeSchema } from './sanitizeSchema';
import type { Root as HastRoot, Element } from 'hast';
import type { Root as MdastRoot } from 'mdast';

function pipe(
  source: string,
  opts: {
    phantomFootnoteLabels?: Set<string>;
    phantomLinkLabels?: Set<string>;
    preserveOrphan?: boolean;
    documentId?: string;
  }
): HastRoot {
  const handlers = buildCrossChunkHandlers();
  const opt = {
    phantomFootnoteLabels: opts.phantomFootnoteLabels ?? new Set(),
    phantomLinkLabels: opts.phantomLinkLabels ?? new Set(),
    preserveOrphan: opts.preserveOrphan ?? true,
    documentId: opts.documentId ?? 'doc',
  };
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { handlers, ...opt } as Parameters<typeof remarkRehype>[0]);
  const mdast = processor.parse(source) as MdastRoot;
  return processor.runSync(mdast) as HastRoot;
}

function findTag(root: HastRoot, tagName: string): Element | null {
  let found: Element | null = null;
  visit(root, 'element', (n) => {
    if ((n as Element).tagName === tagName && !found) found = n as Element;
  });
  return found;
}

describe('customMdastHandlers — Direction A footnoteDefinition', () => {
  test('orphan def with preserveOrphan=true: <section data-footnotes> generated', () => {
    const hast = pipe('[^x]: orphan content', { preserveOrphan: true });
    const section = findTag(hast, 'section');
    expect(section).toBeTruthy();
    expect(section?.properties?.dataFootnotes).toBeDefined();
  });

  test('orphan def with preserveOrphan=false: no section', () => {
    const hast = pipe('[^x]: orphan content', { preserveOrphan: false });
    const section = findTag(hast, 'section');
    expect(section).toBeNull();
  });

  test('phantom def label is skipped (no footer entry)', () => {
    const hast = pipe('[^x]: __aimd_sentinel_fn__', {
      preserveOrphan: true,
      phantomFootnoteLabels: new Set(['X']),
    });
    const section = findTag(hast, 'section');
    expect(section).toBeNull();
  });
});

describe('customMdastHandlers — Direction B linkReference', () => {
  test('linkReference with phantom-injected def emits <cross-chunk-link>', () => {
    const augmented =
      '[click][X]' +
      buildPhantomSuffix({
        missingFootnotes: new Set(),
        missingLinks: new Set(['X']),
      });
    const hast = pipe(augmented, { phantomLinkLabels: new Set(['X']), documentId: 'msg-1' });
    const link = findTag(hast, 'cross-chunk-link');
    expect(link).toBeTruthy();
    expect(link?.properties?.label).toBe('X');
    expect(link?.properties?.referenceType).toBe('full');
    expect(link?.properties?.documentId).toBe('msg-1');
  });

  test("a reference to the chunk's OWN def carries localUrl/localTitle; a phantom carries none (core-render-02)", () => {
    const own = pipe('[click][own] and ![pic][own]\n\n[own]: https://example.com/own "T"', {});
    const props: unknown[] = [];
    visit(own, 'element', (el) => {
      if (el.tagName === 'cross-chunk-link' || el.tagName === 'cross-chunk-image') props.push(el.properties);
    });
    expect(props).toHaveLength(2);
    for (const p of props as Array<{ localUrl?: string; localTitle?: string }>) {
      expect(p.localUrl).toBe('https://example.com/own');
      expect(p.localTitle).toBe('T');
    }
    const phantom = pipe(
      '[click][X]' + buildPhantomSuffix({ missingFootnotes: new Set(), missingLinks: new Set(['X']) }),
      { phantomLinkLabels: new Set(['X']) }
    );
    const link = findTag(phantom, 'cross-chunk-link');
    expect(link?.properties?.localUrl).toBeUndefined();
  });

  test('footnote-sup carries localNumber = footnoteOrder position of a real local def', () => {
    const hast = pipe('x[^b] y[^a] z[^b]\n\n[^a]: A\n\n[^b]: B', {});
    const nums: unknown[] = [];
    visit(hast, 'element', (el) => {
      if (el.tagName === 'footnote-sup') nums.push([el.properties?.localNumber, el.properties?.localOccurrence]);
    });
    expect(nums).toEqual([
      [1, 1],
      [2, 1],
      [1, 2],
    ]);
  });

  test('a padded label reaches the placeholder VERBATIM (registry lookups must trim — eng-stream-01)', () => {
    // mdast keeps the source label (` X ` / `x\ny`) and only the identifier
    // is normalized; the placeholder forwards the label so hrefs line up
    // with mdast-util-to-hast's source-cased <li id>. The registry side
    // therefore owns the trim (normalizeId → micromark normalizeIdentifier).
    const augmented =
      '[click][ X ] and [ x\ny ]' +
      buildPhantomSuffix({
        missingFootnotes: new Set(),
        missingLinks: new Set(['X', 'X Y']),
      });
    const hast = pipe(augmented, { phantomLinkLabels: new Set(['X', 'X Y']), documentId: 'msg-1' });
    const labels: unknown[] = [];
    visit(hast, 'element', (el) => {
      if (el.tagName === 'cross-chunk-link') labels.push(el.properties?.label);
    });
    expect(labels).toEqual([' X ', ' x\ny ']);
  });

  test('linkReference with no source def emits no placeholder (mdast drops the node)', () => {
    // Verified by experiment: remark-parse with `[click][nope]` and NO
    // `[nope]:` definition emits plain text — no linkReference node — so
    // the handler never fires and no placeholder appears. This is the
    // correct behavior: the literal `[click][nope]` brackets render
    // verbatim, which matches the standalone fallback. Pinned to lock
    // remark-parse's behavior; if a future remark version emits
    // linkReference for unresolved labels, the custom handler's
    // defense-in-depth `!resolved → undefined` path needs revisiting.
    const hast = pipe('[click][nope]', {});
    const link = findTag(hast, 'cross-chunk-link');
    expect(link).toBeNull();
  });
});

describe('customMdastHandlers — footnoteReference with phantom def', () => {
  test('emits <footnote-sup> with mdast folded identifier; does NOT add label to footer', () => {
    const augmented =
      'See [^X].' +
      buildPhantomSuffix({
        missingFootnotes: new Set(['X']),
        missingLinks: new Set(),
      });
    const hast = pipe(augmented, { phantomFootnoteLabels: new Set(['X']) });
    const sup = findTag(hast, 'footnote-sup');
    expect(sup).toBeTruthy();
    expect(sup?.properties?.label).toBe('x');
    const section = findTag(hast, 'section');
    expect(section).toBeNull(); // phantom skip prevented footer
  });

  test('real footnote ref also uses mdast folded identifier', () => {
    const hast = pipe('See [^Foo].\n\n[^Foo]: body', {});
    const sup = findTag(hast, 'footnote-sup');
    expect(sup).toBeTruthy();
    expect(sup?.properties?.label).toBe('foo');
  });

  test('localOccurrence survives the FULL pipeline as a string-coerced numeric value', () => {
    // Real-pipeline regression. rehype-raw's parse5 round-trip stringifies
    // numeric hast properties — `localOccurrence: 2` (number) becomes the
    // string `"2"` after the pipeline. Earlier code in FootnoteSupNumber
    // used `typeof === 'number'` as the gate, which would have returned
    // null for every multi-ref disambiguation in real-world usage,
    // silently collapsing all per-occurrence `fnref-X-N` ids to the bare
    // `fnref-X` first-occurrence form. The fix is in the consumer:
    // FootnoteSupNumber's `coerceLocalOccurrence` accepts either number
    // OR numeric-string and coerces. This test pins down the
    // string-emission shape so a future pipeline upgrade that DROPS the
    // value entirely (rather than just stringifying it) fails loudly.
    const handlers = buildCrossChunkHandlers();
    const opt = {
      phantomFootnoteLabels: new Set<string>(),
      phantomLinkLabels: new Set<string>(),
      preserveOrphan: true,
      documentId: 'doc',
    };
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { handlers, ...opt } as Parameters<typeof remarkRehype>[0])
      .use(rehypeRaw, { passThrough: [] })
      .use(rehypeSanitize, sanitizeSchema);
    const mdast = processor.parse('See [^x] and [^x] again.\n\n[^x]: body') as MdastRoot;
    const hast = processor.runSync(mdast) as HastRoot;
    const sups: Element[] = [];
    visit(hast, 'element', (n) => {
      if ((n as Element).tagName === 'footnote-sup') sups.push(n as Element);
    });
    expect(sups.length).toBe(2);
    // The value survives the pipeline. Numeric or string form — both are
    // tolerated by FootnoteSupNumber's coerceLocalOccurrence. What MUST
    // hold: the value is present, coerces to the right number, and is
    // distinguishable across the two refs.
    const occ0 = Number(sups[0].properties?.localOccurrence);
    const occ1 = Number(sups[1].properties?.localOccurrence);
    expect(occ0).toBe(1);
    expect(occ1).toBe(2);
  });

  test('cross-chunk-link referenceType survives the FULL pipeline (rehype-raw + sanitize)', () => {
    // referenceType is a string, so it doesn't get stringified — but
    // verifying it survives the full pipeline locks the fallback path
    // (CrossChunkLink renders `[text][label]` only when referenceType
    // arrives correctly).
    const handlers = buildCrossChunkHandlers();
    const opt = {
      phantomFootnoteLabels: new Set<string>(),
      phantomLinkLabels: new Set<string>(['MISSING']),
      preserveOrphan: true,
      documentId: 'doc',
    };
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { handlers, ...opt } as Parameters<typeof remarkRehype>[0])
      .use(rehypeRaw, { passThrough: [] })
      .use(rehypeSanitize, sanitizeSchema);
    const augmented =
      '[click][missing]\n' +
      buildPhantomSuffix({
        missingFootnotes: new Set(),
        missingLinks: new Set(['MISSING']),
      });
    const mdast = processor.parse(augmented) as MdastRoot;
    const hast = processor.runSync(mdast) as HastRoot;
    const link = findTag(hast, 'cross-chunk-link');
    expect(link).toBeTruthy();
    expect(link?.properties?.referenceType).toBe('full');
  });
});

/**
 * STANDALONE-mode regression battery. `pipe()` above installs all FOUR
 * handlers — that is coordinated mode, and it cannot reproduce this bug
 * class: standalone `<AIMarkdown>` (MarkdownContent's no-registry branch)
 * installs ONLY `footnoteDefinition`, leaving `footnoteReference` to
 * mdast-util-to-hast's default handler. That default decides "already
 * registered?" by `footnoteCounts`, while Direction A's push is keyed on
 * `footnoteOrder` — the two must stay in sync or a definition that appears
 * above its first reference gets registered twice (duplicate `<li>` with
 * colliding ids, sup marker numbered by array length).
 */
describe('customMdastHandlers — standalone mode (footnoteDefinition only)', () => {
  function standalonePipe(source: string, opts: { preserveOrphan?: boolean } = {}): HastRoot {
    const { footnoteDefinition } = buildCrossChunkHandlers();
    const opt = {
      phantomFootnoteLabels: new Set<string>(),
      phantomLinkLabels: new Set<string>(),
      preserveOrphan: opts.preserveOrphan ?? true,
      documentId: 'doc',
    };
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { handlers: { footnoteDefinition }, ...opt } as Parameters<typeof remarkRehype>[0]);
    const mdast = processor.parse(source) as MdastRoot;
    return processor.runSync(mdast) as HastRoot;
  }

  function collect(root: HastRoot, pred: (el: Element) => boolean): Element[] {
    const out: Element[] = [];
    visit(root, 'element', (n) => {
      if (pred(n as Element)) out.push(n as Element);
    });
    return out;
  }

  const footerLis = (root: HastRoot) =>
    collect(root, (el) => el.tagName === 'li' && String(el.properties?.id ?? '').includes('fn-'));
  const refMarkers = (root: HastRoot) =>
    collect(root, (el) => el.tagName === 'a' && el.properties?.dataFootnoteRef !== undefined);
  const backrefs = (root: HastRoot) =>
    collect(root, (el) => el.tagName === 'a' && el.properties?.dataFootnoteBackref !== undefined);
  const markerText = (el: Element) => (el.children ?? []).map((c) => ('value' in c ? String(c.value) : '')).join('');

  test('definition ABOVE its reference: one <li>, marker numbered 1, backref intact', () => {
    const hast = standalonePipe('[^a]: Note A.\n\nProse citing[^a] the note.');
    const lis = footerLis(hast);
    expect(lis.length).toBe(1);
    expect(lis[0].properties?.id).toBe('user-content-fn-a');
    const markers = refMarkers(hast);
    expect(markers.length).toBe(1);
    expect(markerText(markers[0])).toBe('1');
    expect(backrefs(hast).length).toBe(1);
  });

  test('definition above TWO references: one <li>, both markers 1, occurrence-suffixed backrefs', () => {
    const hast = standalonePipe('[^a]: Note A.\n\nfoo[^a] bar[^a]');
    expect(footerLis(hast).length).toBe(1);
    const markers = refMarkers(hast);
    expect(markers.length).toBe(2);
    expect(markers.map(markerText)).toEqual(['1', '1']);
    const backrefHrefs = backrefs(hast).map((a) => String(a.properties?.href));
    expect(backrefHrefs).toEqual(['#user-content-fnref-a', '#user-content-fnref-a-2']);
  });

  test('case-folded label ([^A] def above [^a] ref): seed and default handler agree on the key', () => {
    // The seed is written under normalizeId (toUpperCase); the default
    // reference handler keys footnoteCounts by String(identifier).toUpperCase().
    // If those two normalizations ever drift apart, the seed misses and the
    // duplicate-registration bug returns for case-varied labels.
    const hast = standalonePipe('[^A]: Note A.\n\nProse citing[^a] the note.');
    expect(footerLis(hast).length).toBe(1);
    const markers = refMarkers(hast);
    expect(markers.length).toBe(1);
    expect(markerText(markers[0])).toBe('1');
  });

  test('pure orphan (no reference at all): one <li>, and NO dangling backref', () => {
    // Pins the "seed 0, not 1" half of the fix: a count >= 1 would make
    // state.footer() emit a backref pointing at a fnref anchor that does not
    // exist. Pure-orphan output must stay exactly as it was before the fix.
    const hast = standalonePipe('[^x]: orphan content');
    expect(footerLis(hast).length).toBe(1);
    expect(backrefs(hast).length).toBe(0);
  });

  test('reference above definition (control): shape identical to def-above-ref', () => {
    const hast = standalonePipe('Prose citing[^a] the note.\n\n[^a]: Note A.');
    expect(footerLis(hast).length).toBe(1);
    const markers = refMarkers(hast);
    expect(markers.length).toBe(1);
    expect(markerText(markers[0])).toBe('1');
    expect(backrefs(hast).length).toBe(1);
  });

  test('multiple defs above refs, refs in SWAPPED order: def-encounter order wins the numbering', () => {
    // Declared preserveOrphan semantics, not an accident: Direction A pushes
    // ids into footnoteOrder at DEFINITION-encounter time, so when several
    // defs precede their refs the footer lists them in definition order and
    // the sup markers number by that order — here [^b] is marker "2" even
    // though it is referenced first. GitHub (no orphan protection) would
    // number by reference order instead. Internally consistent: each marker
    // matches its footer position and every anchor resolves. If this shape
    // ever needs GitHub-parity numbering, that is a semantics change to
    // Direction A, not a bug fix here.
    const hast = standalonePipe('[^a]: A.\n\n[^b]: B.\n\nUse[^b] then[^a].');
    expect(footerLis(hast).length).toBe(2);
    const markers = refMarkers(hast);
    expect(markers.map(markerText)).toEqual(['2', '1']);
    const ids = footerLis(hast).map((li) => String(li.properties?.id));
    expect(ids).toEqual(['user-content-fn-a', 'user-content-fn-b']);
  });

  test('no duplicate footer ids in any ordering', () => {
    for (const src of [
      '[^a]: Note A.\n\nProse citing[^a] the note.',
      'Prose citing[^a] the note.\n\n[^a]: Note A.',
      '[^a]: A.\n\n[^b]: B.\n\nUse[^a] then[^b].',
    ]) {
      const ids = footerLis(standalonePipe(src)).map((li) => String(li.properties?.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('coordinated mode (all four handlers) is unaffected: def-above-ref still single-registered', () => {
    const hast = pipe('[^a]: Note A.\n\nProse citing[^a] the note.', {});
    const sups = collect(hast, (el) => el.tagName === 'footnote-sup');
    expect(sups.length).toBe(1);
    expect(Number(sups[0].properties?.localOccurrence)).toBe(1);
    expect(footerLis(hast).length).toBe(1);
  });
});
