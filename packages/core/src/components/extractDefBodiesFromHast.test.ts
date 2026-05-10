import { describe, test, expect } from 'vitest';
import { extractDefBodiesFromHast } from './extractDefBodiesFromHast';
import type { Element as HastElement, Root as HastRoot } from 'hast';

function root(...children: HastRoot['children']): HastRoot {
  return { type: 'root', children };
}

function makeFooter(items: Array<{ id: string; bodyText: string; withBackref?: boolean }>): HastElement {
  return {
    type: 'element',
    tagName: 'section',
    properties: { dataFootnotes: true, className: ['footnotes'] },
    children: [
      {
        type: 'element',
        tagName: 'ol',
        properties: {},
        children: items.map(({ id, bodyText, withBackref }) => ({
          type: 'element' as const,
          tagName: 'li',
          properties: { id },
          children: [
            {
              type: 'element' as const,
              tagName: 'p',
              properties: {},
              children: [
                { type: 'text' as const, value: bodyText },
                ...(withBackref
                  ? ([
                      {
                        type: 'element' as const,
                        tagName: 'a',
                        properties: {
                          href: `#${id.replace('fn-', 'fnref-')}`,
                          dataFootnoteBackref: '',
                          className: ['data-footnote-backref'],
                        },
                        children: [{ type: 'text' as const, value: ' ↩' }],
                      },
                    ] as HastElement['children'])
                  : []),
              ],
            },
          ],
        })),
      },
    ],
  };
}

describe('extractDefBodiesFromHast', () => {
  test('extracts bodies keyed by normalized label', () => {
    const tree = root(
      makeFooter([
        { id: 'user-content-fn-x', bodyText: 'def x' },
        { id: 'user-content-fn-y', bodyText: 'def y' },
      ])
    );
    const bodies = extractDefBodiesFromHast(tree);
    expect(bodies.size).toBe(2);
    expect(bodies.has('X')).toBe(true);
    expect(bodies.has('Y')).toBe(true);
    const xBody = bodies.get('X')!;
    expect(xBody.length).toBe(1);
    expect((xBody[0] as HastElement).tagName).toBe('p');
  });

  test('strips auto-emitted backref anchors appended inside the last <p>', () => {
    const tree = root(makeFooter([{ id: 'user-content-fn-x', bodyText: 'body', withBackref: true }]));
    const bodies = extractDefBodiesFromHast(tree);
    const p = bodies.get('X')![0] as HastElement;
    const anchors = p.children.filter((c) => c.type === 'element' && (c as HastElement).tagName === 'a');
    expect(anchors.length).toBe(0);
  });

  test('preserves user-content anchors that happen to look like backrefs but live mid-body', () => {
    // A user-supplied data-footnote-backref-shaped anchor that is NOT in the
    // trailing position must survive — we should only strip the auto-emitted
    // tail anchors, not the ones the user typed into their def body.
    const userBackrefShape: HastElement = {
      type: 'element',
      tagName: 'a',
      properties: { href: '#somewhere', dataFootnoteBackref: '' },
      children: [{ type: 'text', value: 'user link' }],
    };
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [
            {
              type: 'element',
              tagName: 'ol',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'li',
                  properties: { id: 'user-content-fn-x' },
                  children: [
                    {
                      type: 'element',
                      tagName: 'p',
                      properties: {},
                      children: [{ type: 'text', value: 'pre ' }, userBackrefShape, { type: 'text', value: ' post' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    const p = bodies.get('X')![0] as HastElement;
    const anchors = p.children.filter((c) => c.type === 'element' && (c as HastElement).tagName === 'a');
    expect(anchors.length).toBe(1); // user content survives
  });

  test("undoes mdast-util-to-hast's merged-separator: trims the ' ' it appended into the trailing text node", () => {
    // Per mdast-util-to-hast/lib/footer.js: when the last child of <p> is
    // a text node, the leading separator is merged in-place (tailTail.value
    // += ' ') rather than pushed as a standalone text node. We must undo
    // that single trailing space so the aggregate footer's own separator
    // doesn't visibly double.
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [
            {
              type: 'element',
              tagName: 'ol',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'li',
                  properties: { id: 'user-content-fn-x' },
                  children: [
                    {
                      type: 'element',
                      tagName: 'p',
                      properties: {},
                      children: [
                        { type: 'text', value: 'hello ' }, // merged separator
                        {
                          type: 'element',
                          tagName: 'a',
                          properties: { dataFootnoteBackref: '' },
                          children: [{ type: 'text', value: '↩' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    const p = bodies.get('X')![0] as HastElement;
    expect(p.children.length).toBe(1);
    expect((p.children[0] as { value: string }).value).toBe('hello');
  });

  test('preserves user-intentional trailing whitespace when there is no backref to undo', () => {
    // Without an auto-emitted backref, we have no business trimming the
    // trailing space — leave the def body exactly as the renderer produced it.
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [
            {
              type: 'element',
              tagName: 'ol',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'li',
                  properties: { id: 'user-content-fn-x' },
                  children: [
                    {
                      type: 'element',
                      tagName: 'p',
                      properties: {},
                      children: [{ type: 'text', value: 'hello ' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    const p = bodies.get('X')![0] as HastElement;
    expect((p.children[0] as { value: string }).value).toBe('hello ');
  });

  test("strips backref through mdast-util-to-hast's state.wrap shape (real <li> children with trailing \\n)", () => {
    // Confirmed via a real-pipeline trace: mdast-util-to-hast's state.wrap
    // interleaves \n text nodes between block-level <li> children. For a
    // normal def with a trailing <p>, the <li> children are:
    //   ['\n', <p>...backref</p>, '\n']
    // The previous strip-recursion logic looked at the literal last child
    // (which was '\n') and bailed without recursing into <p>, leaving the
    // auto-emitted backref intact — which the aggregate footer would then
    // visibly DOUBLE on the cross-chunk render path.
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [
            {
              type: 'element',
              tagName: 'ol',
              properties: {},
              children: [
                { type: 'text', value: '\n' },
                {
                  type: 'element',
                  tagName: 'li',
                  properties: { id: 'user-content-fn-x' },
                  children: [
                    { type: 'text', value: '\n' },
                    {
                      type: 'element',
                      tagName: 'p',
                      properties: {},
                      children: [
                        { type: 'text', value: 'body text ' },
                        {
                          type: 'element',
                          tagName: 'a',
                          properties: {
                            href: '#user-content-fnref-x',
                            dataFootnoteBackref: '',
                            className: ['data-footnote-backref'],
                          },
                          children: [{ type: 'text', value: '↩' }],
                        },
                      ],
                    },
                    { type: 'text', value: '\n' },
                  ],
                },
                { type: 'text', value: '\n' },
              ],
            },
          ],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    const liBody = bodies.get('X')!;
    // The trailing \n text nodes around the <p> stay (semantically part of
    // mdast-util-to-hast's emitted shape) but the backref inside <p> is gone.
    const p = liBody.find((c) => c.type === 'element' && (c as HastElement).tagName === 'p') as HastElement;
    expect(p).toBeTruthy();
    const anchors = p.children.filter((c) => c.type === 'element' && (c as HastElement).tagName === 'a');
    expect(anchors.length).toBe(0);
    // Merged separator trimmed too.
    expect((p.children[0] as { value: string }).value).toBe('body text');
  });

  test('strips trailing backref in empty-def case-B with wrap-emitted whitespace', () => {
    // Empty def: mdast-util-to-hast pushes the backref directly into <li>
    // (case B in footer.js), then state.wrap surrounds it with \n nodes:
    //   ['\n', <a backref>, '\n']
    // The strip must peel the backref but preserve the whitespace tail so
    // downstream serialization stays predictable.
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [
            {
              type: 'element',
              tagName: 'ol',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'li',
                  properties: { id: 'user-content-fn-x' },
                  children: [
                    { type: 'text', value: '\n' },
                    {
                      type: 'element',
                      tagName: 'a',
                      properties: { dataFootnoteBackref: '' },
                      children: [{ type: 'text', value: '↩' }],
                    },
                    { type: 'text', value: '\n' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    const liBody = bodies.get('X')!;
    const anchors = liBody.filter((c) => c.type === 'element' && (c as HastElement).tagName === 'a');
    expect(anchors.length).toBe(0);
  });

  test('strips multiple trailing backrefs (multi-ref case)', () => {
    // mdast-util-to-hast appends N backref anchors (each preceded by a ` `
    // text separator) when a label is referenced N times. All N must come
    // off; nothing before them should.
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [
            {
              type: 'element',
              tagName: 'ol',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'li',
                  properties: { id: 'user-content-fn-x' },
                  children: [
                    {
                      type: 'element',
                      tagName: 'p',
                      properties: {},
                      children: [
                        { type: 'text', value: 'body' },
                        { type: 'text', value: ' ' },
                        {
                          type: 'element',
                          tagName: 'a',
                          properties: { dataFootnoteBackref: '' },
                          children: [{ type: 'text', value: '↩' }],
                        },
                        { type: 'text', value: ' ' },
                        {
                          type: 'element',
                          tagName: 'a',
                          properties: { dataFootnoteBackref: '' },
                          children: [{ type: 'text', value: '↩2' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    const p = bodies.get('X')![0] as HastElement;
    expect(p.children.length).toBe(1);
    expect((p.children[0] as { value: string }).value).toBe('body');
  });

  test('decodes percent-encoded labels (CJK / non-ASCII)', () => {
    // mdast-util-to-hast's footer percent-encodes <li id> via normalizeUri,
    // so a `[^中文]` label arrives as `<li id="user-content-fn-%E4%B8%AD%E6%96%87">`.
    // The registry's def key is the DECODED form (`中文` → normalizeId →
    // `中文`). Without decodeURIComponent here, the harvested key
    // `%E4%B8%AD%E6%96%87` would never match the registry's `中文`, leaving
    // the aggregate footer with an empty <li> for every non-ASCII label.
    const tree = root(makeFooter([{ id: 'user-content-fn-%E4%B8%AD%E6%96%87', bodyText: '中文 body' }]));
    const bodies = extractDefBodiesFromHast(tree);
    expect(bodies.has('中文')).toBe(true);
    const body = bodies.get('中文')!;
    const p = body[0] as HastElement;
    expect((p.children[0] as { value: string }).value).toBe('中文 body');
  });

  test('decodes percent-encoded labels with the exact-clobberPrefix path', () => {
    const clobberPrefix = 'doc-';
    const tree = root(makeFooter([{ id: `${clobberPrefix}fn-%E4%B8%AD%E6%96%87`, bodyText: 'cjk' }]));
    const bodies = extractDefBodiesFromHast(tree, clobberPrefix);
    expect(bodies.has('中文')).toBe(true);
  });

  test('handles clobber-prefixed ids', () => {
    const tree = root(makeFooter([{ id: 'msg-1-user-content-fn-x', bodyText: 'def x' }]));
    const bodies = extractDefBodiesFromHast(tree);
    expect(bodies.has('X')).toBe(true);
  });

  test('uses exact clobberPrefix before regex fallback', () => {
    const clobberPrefix = 'doc-user-content-fn-decoy-user-content-';
    const tree = root(makeFooter([{ id: `${clobberPrefix}fn-a.b(1)`, bodyText: 'def x' }]));
    const bodies = extractDefBodiesFromHast(tree, clobberPrefix);
    expect(bodies.has('A.B(1)')).toBe(true);
    expect(bodies.has('DECOY-USER-CONTENT-FN-A.B(1)')).toBe(false);
  });

  test('strips localOccurrence from harvested <footnote-sup> placeholders (nested-refs case)', () => {
    // A def body containing a nested footnote ref (e.g. `[^x]: see [^y]`)
    // renders to a `<footnote-sup>` whose `localOccurrence` is keyed to
    // the parsing chunk's counter. When the aggregate footer renders the
    // harvested body under the LAST chunk's ChunkSymbolContext, that local
    // index is meaningless — `globalOccurrenceForRef(lastChunkSym, …)`
    // walks the last chunk's refs and returns null, blanking the sup.
    // Stripping `localOccurrence` from the harvested copy degrades the
    // render to "bare first-occurrence href" rather than null.
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [
            {
              type: 'element',
              tagName: 'ol',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'li',
                  properties: { id: 'user-content-fn-x' },
                  children: [
                    {
                      type: 'element',
                      tagName: 'p',
                      properties: {},
                      children: [
                        { type: 'text', value: 'see ' },
                        {
                          type: 'element',
                          tagName: 'footnote-sup',
                          properties: { label: 'y', localOccurrence: 1, documentId: 'd' },
                          children: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    const liBody = bodies.get('X')!;
    const p = liBody[0] as HastElement;
    const sup = p.children.find(
      (c) => c.type === 'element' && (c as HastElement).tagName === 'footnote-sup'
    ) as HastElement;
    expect(sup).toBeTruthy();
    expect(sup.properties).not.toHaveProperty('localOccurrence');
    // Other props survive.
    expect(sup.properties?.label).toBe('y');
    expect(sup.properties?.documentId).toBe('d');
  });

  test('returns empty map when there is no <section data-footnotes>', () => {
    const tree = root({
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [{ type: 'text', value: 'no footer here' }],
    });
    const bodies = extractDefBodiesFromHast(tree);
    expect(bodies.size).toBe(0);
  });

  test('nested <section data-footnotes> processed exactly once (no double-write)', () => {
    // Pathological shape produced only by raw-HTML user content surviving
    // rehype-raw + sanitize: a `<section data-footnotes>` nested inside
    // another. Without `SKIP` in the outer visit, the inner section's
    // `<li>`s would be enumerated TWICE — once by the outer section's
    // inner-visit (which descends into the nested section), and again
    // when the outer visit's own recursion reaches the nested section.
    // `out.set` is last-write-wins; a stale duplicate would stomp the
    // correct extracted body. The SKIP keeps each `<li>` harvested once.
    const innerLi: HastElement = {
      type: 'element',
      tagName: 'li',
      properties: { id: 'user-content-fn-x' },
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'inner-body' }] }],
    };
    const nestedSection: HastElement = {
      type: 'element',
      tagName: 'section',
      properties: { dataFootnotes: true },
      children: [{ type: 'element', tagName: 'ol', properties: {}, children: [innerLi] }],
    };
    const outerLi: HastElement = {
      type: 'element',
      tagName: 'li',
      properties: { id: 'user-content-fn-outer' },
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: 'before-nested ' },
            nestedSection,
            { type: 'text', value: ' after-nested' },
          ],
        },
      ],
    };
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [{ type: 'element', tagName: 'ol', properties: {}, children: [outerLi] }],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    // Both the outer X and OUTER labels resolve to their respective bodies.
    expect(bodies.size).toBe(2);
    expect(bodies.has('X')).toBe(true);
    expect(bodies.has('OUTER')).toBe(true);
    // Critical: the inner X body is the inner section's content, harvested
    // exactly once. A double-write would surface as a non-deterministic
    // (last-set-wins) shape depending on visit ordering.
    const xBody = bodies.get('X')!;
    const xP = xBody.find((c) => c.type === 'element' && (c as HastElement).tagName === 'p') as HastElement;
    expect(xP).toBeTruthy();
    expect((xP.children[0] as { value: string }).value).toBe('inner-body');
  });

  test('ignores <li> outside <section data-footnotes>', () => {
    // An ordinary ordered list with an id that happens to start with `user-content-fn-`
    // should not be misclassified.
    const tree = root({
      type: 'element',
      tagName: 'ol',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'li',
          properties: { id: 'user-content-fn-x' },
          children: [{ type: 'text', value: 'oops' }],
        },
      ],
    });
    const bodies = extractDefBodiesFromHast(tree);
    expect(bodies.size).toBe(0);
  });
});
