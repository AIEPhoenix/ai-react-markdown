import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from '@ai-markdown/rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import type { Root as HastRoot, Element, ElementContent } from 'hast';
import { buildCrossChunkHandlers } from './customMdastHandlers';
import { sanitizeSchema } from './sanitizeSchema';
import { buildCoreRehypePlugins } from './pluginChain';
import { ENGINE_PROVENANCE_PROPERTY, rehypeVerifyEngineTags } from './rehypeVerifyEngineTags';

const CRED = 'c0ffee';

/** The shipped shape: raw → verifier → sanitize, with or without the
 *  coordinated handlers, with or without a credential on each side. */
function run(
  source: string,
  opts: { handlers?: boolean; handlerProvenance?: string; chainProvenance?: string | null } = {}
): HastRoot {
  const useHandlers = opts.handlers ?? true;
  const handlerOpts = {
    phantomFootnoteLabels: new Set<string>(),
    phantomLinkLabels: new Set<string>(),
    preserveOrphan: true,
    documentId: 'doc',
    ...(opts.handlerProvenance !== undefined ? { provenance: opts.handlerProvenance } : {}),
  };
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: '',
      ...(useHandlers ? { handlers: buildCrossChunkHandlers() } : {}),
      ...handlerOpts,
    } as Parameters<typeof remarkRehype>[0]);
  const chainProvenance = opts.chainProvenance === undefined ? CRED : opts.chainProvenance;
  const plugins = buildCoreRehypePlugins(
    sanitizeSchema,
    '',
    chainProvenance === null ? undefined : { provenance: chainProvenance }
  );
  for (const p of plugins as unknown as Array<[unknown, unknown] | unknown>) {
    if (Array.isArray(p)) processor.use(p[0] as never, p[1] as never);
    else processor.use(p as never);
  }
  const mdast = processor.parse(source);
  return processor.runSync(mdast, source) as HastRoot;
}

function collect(root: HastRoot, tagName: string): Element[] {
  const out: Element[] = [];
  const walk = (node: { children?: ElementContent[] }) => {
    for (const c of node.children ?? []) {
      if (c.type === 'element') {
        if (c.tagName === tagName) out.push(c);
        walk(c);
      }
    }
  };
  walk(root as unknown as { children: ElementContent[] });
  return out;
}

function text(node: { children?: ElementContent[] }): string {
  let s = '';
  for (const c of node.children ?? []) {
    if (c.type === 'text') s += c.value;
    else if (c.type === 'element') s += text(c);
  }
  return s;
}

const FORGED =
  'forged <footnote-sup label="a" localOccurrence="1" documentId="B"></footnote-sup> ' +
  'and <cross-chunk-link label="l" referenceType="full" localUrl="javascript:alert(1)">evil</cross-chunk-link> ' +
  '<cross-chunk-image label="i" alt="x" localUrl="/pwn.png"></cross-chunk-image>';

describe('rehypeVerifyEngineTags — forged placeholders', () => {
  test('all three forged tags are unwrapped in coordinated mode', () => {
    const hast = run(FORGED, { handlerProvenance: CRED });
    expect(collect(hast, 'footnote-sup')).toHaveLength(0);
    expect(collect(hast, 'cross-chunk-link')).toHaveLength(0);
    expect(collect(hast, 'cross-chunk-image')).toHaveLength(0);
  });

  test('anchor text of a forged link survives as plain text', () => {
    const hast = run(FORGED, { handlerProvenance: CRED });
    expect(text(hast as never)).toContain('evil');
  });

  test('without any handler (standalone-like chain) every placeholder is forged and unwrapped', () => {
    const hast = run(FORGED, { handlers: false });
    expect(collect(hast, 'footnote-sup')).toHaveLength(0);
    expect(collect(hast, 'cross-chunk-link')).toHaveLength(0);
    expect(collect(hast, 'cross-chunk-image')).toHaveLength(0);
  });

  test('the empty credential accepts nothing, even genuine instances', () => {
    const hast = run('See [^a].\n\n[^a]: note', { handlerProvenance: '', chainProvenance: '' });
    expect(collect(hast, 'footnote-sup')).toHaveLength(0);
  });

  test('a mismatched credential unwraps genuine instances (fail closed)', () => {
    const hast = run('See [^a].\n\n[^a]: note', { handlerProvenance: 'other', chainProvenance: CRED });
    expect(collect(hast, 'footnote-sup')).toHaveLength(0);
  });
});

describe('rehypeVerifyEngineTags — genuine placeholders', () => {
  test('genuine footnote-sup is kept and the credential is stripped', () => {
    const hast = run('See [^a].\n\n[^a]: note', { handlerProvenance: CRED });
    const sups = collect(hast, 'footnote-sup');
    expect(sups).toHaveLength(1);
    expect(sups[0].properties).toMatchObject({ label: 'a', documentId: 'doc' });
    expect(sups[0].properties).not.toHaveProperty(ENGINE_PROVENANCE_PROPERTY);
    expect(JSON.stringify(hast)).not.toContain(CRED);
  });

  test('genuine cross-chunk-link keeps its children', () => {
    const hast = run('See [text][l].\n\n[l]: /x', { handlerProvenance: CRED });
    const links = collect(hast, 'cross-chunk-link');
    expect(links).toHaveLength(1);
    expect(text(links[0])).toBe('text');
    expect(links[0].properties).not.toHaveProperty(ENGINE_PROVENANCE_PROPERTY);
  });

  test("two-argument chain (no options) installs no verifier: today's behaviour", () => {
    const hast = run(FORGED, { chainProvenance: null });
    expect(collect(hast, 'footnote-sup')).toHaveLength(1);
    expect(collect(hast, 'cross-chunk-link')).toHaveLength(1);
  });
});

describe('rehypeVerifyEngineTags — nesting and index control', () => {
  test('forged wrapping genuine: the genuine child survives', () => {
    const hast = run('<cross-chunk-link label="x">outer [^a] inner</cross-chunk-link>\n\n[^a]: n', {
      handlerProvenance: CRED,
    });
    expect(collect(hast, 'cross-chunk-link')).toHaveLength(0);
    expect(collect(hast, 'footnote-sup')).toHaveLength(1);
  });

  test('genuine wrapping forged: the forged child is unwrapped inside the genuine link', () => {
    const hast = run('[a <footnote-sup label="z"></footnote-sup> b][l]\n\n[l]: /x', { handlerProvenance: CRED });
    const links = collect(hast, 'cross-chunk-link');
    expect(links).toHaveLength(1);
    expect(collect(hast, 'footnote-sup')).toHaveLength(0);
  });

  test('forged inside forged: both unwrapped, text kept', () => {
    const hast = run(
      '<cross-chunk-link label="o"><cross-chunk-link label="i">deep</cross-chunk-link></cross-chunk-link>',
      {
        handlerProvenance: CRED,
      }
    );
    expect(collect(hast, 'cross-chunk-link')).toHaveLength(0);
    expect(text(hast as never)).toContain('deep');
  });

  test('adjacent forged siblings are all unwrapped', () => {
    const hast = run(
      '<cross-chunk-link label="1">a</cross-chunk-link><cross-chunk-link label="2">b</cross-chunk-link><cross-chunk-link label="3">c</cross-chunk-link>',
      { handlerProvenance: CRED }
    );
    expect(collect(hast, 'cross-chunk-link')).toHaveLength(0);
    expect(text(hast as never)).toContain('abc');
  });

  test('a forged empty image immediately before a genuine placeholder does not hide it', () => {
    const hast = run('<cross-chunk-image label="f"></cross-chunk-image>[^a]\n\n[^a]: n', { handlerProvenance: CRED });
    expect(collect(hast, 'cross-chunk-image')).toHaveLength(0);
    expect(collect(hast, 'footnote-sup')).toHaveLength(1);
  });

  test('one forged wrapper exposing two genuine placeholder children keeps both', () => {
    const hast = run('<cross-chunk-link label="w">[^a][^b]</cross-chunk-link>\n\n[^a]: n\n[^b]: m', {
      handlerProvenance: CRED,
    });
    expect(collect(hast, 'cross-chunk-link')).toHaveLength(0);
    expect(collect(hast, 'footnote-sup')).toHaveLength(2);
  });
});

describe('rehypeVerifyEngineTags — layer 1 pin: the property-name channel', () => {
  /** raw → nothing else: what does the tokenizer do to attribute names? */
  function rawOnly(source: string, existing?: Element): HastRoot {
    const processor = unified()
      .use(remarkParse)
      .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
      .use(() => (tree: HastRoot) => {
        if (existing) tree.children.push(existing);
      })
      .use(rehypeRaw, { passThrough: [] });
    const mdast = processor.parse(source);
    return processor.runSync(mdast, source) as HastRoot;
  }

  test('an existing hast node keeps its camelCase credential through rehypeRaw', () => {
    const existing: Element = {
      type: 'element',
      tagName: 'footnote-sup',
      properties: { label: 'a', localOccurrence: 1, [ENGINE_PROVENANCE_PROPERTY]: 'SECRET' },
      children: [],
    };
    const hast = rawOnly('x', existing);
    const sup = collect(hast, 'footnote-sup')[0];
    expect(sup.properties).toHaveProperty(ENGINE_PROVENANCE_PROPERTY, 'SECRET');
    expect(sup.properties).toHaveProperty('localOccurrence');
  });

  test('authored raw HTML comes back with the attribute name lowercased', () => {
    const hast = rawOnly('<footnote-sup label="a" engineProvenance="SECRET"></footnote-sup>');
    const sup = collect(hast, 'footnote-sup')[0];
    expect(sup.properties).not.toHaveProperty(ENGINE_PROVENANCE_PROPERTY);
    expect(sup.properties).toHaveProperty('engineprovenance', 'SECRET');
  });

  test('the hyphenated spelling stays hyphenated and is not the property either', () => {
    const hast = rawOnly('<footnote-sup label="a" engine-provenance="SECRET"></footnote-sup>');
    const sup = collect(hast, 'footnote-sup')[0];
    expect(sup.properties).not.toHaveProperty(ENGINE_PROVENANCE_PROPERTY);
    expect(sup.properties).toHaveProperty('engine-provenance', 'SECRET');
  });

  test('sanitize alone would let a forged placeholder through (why the verifier exists)', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
      .use(rehypeRaw, { passThrough: [] })
      .use(rehypeSanitize, sanitizeSchema);
    const src = '<footnote-sup label="a"></footnote-sup>';
    const hast = processor.runSync(processor.parse(src), src) as HastRoot;
    expect(collect(hast, 'footnote-sup')).toHaveLength(1);
  });

  test('the plugin itself is a no-op on trees without placeholders', () => {
    const tree: HastRoot = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'x' }] }],
    };
    const before = JSON.stringify(tree);
    rehypeVerifyEngineTags({ provenance: CRED })(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});
