import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { buildCrossChunkHandlers } from './customMdastHandlers';
import { augmentSourceWithPhantoms } from './remarkInjectPhantomDefs';
import { sanitizeSchema } from './sanitizeSchema';
import type { Root as HastRoot, Element } from 'hast';
import type { Root as MdastRoot } from 'mdast';

function pipe(
  source: string,
  opts: {
    phantomFootnoteLabels?: Set<string>;
    phantomLinkLabels?: Set<string>;
    preserveOrphan?: boolean;
  }
): HastRoot {
  const handlers = buildCrossChunkHandlers();
  const opt = {
    phantomFootnoteLabels: opts.phantomFootnoteLabels ?? new Set(),
    phantomLinkLabels: opts.phantomLinkLabels ?? new Set(),
    preserveOrphan: opts.preserveOrphan ?? true,
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
    const augmented = augmentSourceWithPhantoms('[click][X]', {
      missingFootnotes: new Set(),
      missingLinks: new Set(['X']),
    });
    const hast = pipe(augmented, { phantomLinkLabels: new Set(['X']) });
    const link = findTag(hast, 'cross-chunk-link');
    expect(link).toBeTruthy();
    expect(link?.properties?.label).toBe('X');
    expect(link?.properties?.referenceType).toBe('full');
    // Placeholders read documentId from context, not from a per-element
    // attribute — the handler must not emit one.
    expect(link?.properties?.documentId).toBeUndefined();
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
    const augmented = augmentSourceWithPhantoms('See [^X].', {
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
    };
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { handlers, ...opt } as Parameters<typeof remarkRehype>[0])
      .use(rehypeRaw, { passThrough: [] })
      .use(rehypeSanitize, sanitizeSchema);
    const augmented = augmentSourceWithPhantoms('[click][missing]\n', {
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
