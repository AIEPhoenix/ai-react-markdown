import { describe, test, expect } from 'vitest';
import { extractDefBodiesFromHast, footnoteSafeId, sourceIdFromFootnoteLiId } from './extractDefBodiesFromHast';
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
  test('extracts bodies keyed by the encoded id fragment', () => {
    const tree = root(
      makeFooter([
        { id: 'user-content-fn-x', bodyText: 'def x' },
        { id: 'user-content-fn-y', bodyText: 'def y' },
      ])
    );
    const bodies = extractDefBodiesFromHast(tree);
    expect(bodies.size).toBe(2);
    expect(bodies.has('x')).toBe(true);
    expect(bodies.has('y')).toBe(true);
    const xBody = bodies.get('x')!;
    expect(xBody.length).toBe(1);
    expect((xBody[0] as HastElement).tagName).toBe('p');
  });

  test('strips auto-emitted backref anchors appended inside the last <p>', () => {
    const tree = root(makeFooter([{ id: 'user-content-fn-x', bodyText: 'body', withBackref: true }]));
    const bodies = extractDefBodiesFromHast(tree);
    const p = bodies.get('x')![0] as HastElement;
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
    const p = bodies.get('x')![0] as HastElement;
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
    const p = bodies.get('x')![0] as HastElement;
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
    const p = bodies.get('x')![0] as HastElement;
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
    const liBody = bodies.get('x')!;
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
    const liBody = bodies.get('x')!;
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
    const p = bodies.get('x')![0] as HastElement;
    expect(p.children.length).toBe(1);
    expect((p.children[0] as { value: string }).value).toBe('body');
  });

  test('keys percent-encoded labels (CJK / non-ASCII) by the encoded fragment, matching footnoteSafeId', () => {
    // mdast-util-to-hast's footer percent-encodes <li id> via normalizeUri,
    // so a `[^中文]` label arrives as `<li id="user-content-fn-%E4%B8%AD%E6%96%87">`.
    // The harvest keeps that encoded fragment as the key; the registry side
    // looks bodies up with `footnoteSafeId(def.sourceIdentifier)`, which is
    // the same encoder, so the two agree without a decode step.
    const tree = root(makeFooter([{ id: 'user-content-fn-%E4%B8%AD%E6%96%87', bodyText: '中文 body' }]));
    const bodies = extractDefBodiesFromHast(tree);
    const key = footnoteSafeId('中文');
    expect(key).toBe('%E4%B8%AD%E6%96%87');
    expect(bodies.has(key)).toBe(true);
    const p = bodies.get(key)![0] as HastElement;
    expect((p.children[0] as { value: string }).value).toBe('中文 body');
  });

  test('keys percent-encoded labels with the exact-clobberPrefix path', () => {
    const clobberPrefix = 'doc-';
    const tree = root(makeFooter([{ id: `${clobberPrefix}fn-%E4%B8%AD%E6%96%87`, bodyText: 'cjk' }]));
    const bodies = extractDefBodiesFromHast(tree, clobberPrefix);
    expect(bodies.has(footnoteSafeId('中文'))).toBe(true);
  });

  test('a label containing a valid percent-escape keeps its body (`[^a%41]`)', () => {
    // normalizeUri leaves a well-formed escape alone, so `[^a%41]` is minted
    // as `fn-a%41`. Decoding that fragment gives `aA`, a key no registry def
    // ever has (the def's identifier is `a%41`); comparing encoded forms
    // keeps the body attached. `[^a%b]` (a malformed escape) is encoded to
    // `a%25b` on both sides and keeps working the same way.
    const tree = root(
      makeFooter([
        { id: 'user-content-fn-a%41', bodyText: 'escaped' },
        { id: 'user-content-fn-a%25b', bodyText: 'percent' },
      ])
    );
    const bodies = extractDefBodiesFromHast(tree, 'user-content-');
    expect(footnoteSafeId('a%41')).toBe('a%41');
    expect(footnoteSafeId('a%b')).toBe('a%25b');
    expect((bodies.get(footnoteSafeId('a%41'))![0] as HastElement).children[0]).toMatchObject({ value: 'escaped' });
    expect((bodies.get(footnoteSafeId('a%b'))![0] as HastElement).children[0]).toMatchObject({ value: 'percent' });
    expect(bodies.has('aA')).toBe(false);
    expect(bodies.has('AA')).toBe(false);
  });

  test('handles clobber-prefixed ids', () => {
    const tree = root(makeFooter([{ id: 'msg-1-user-content-fn-x', bodyText: 'def x' }]));
    const bodies = extractDefBodiesFromHast(tree);
    expect(bodies.has('x')).toBe(true);
  });

  test('uses exact clobberPrefix before regex fallback', () => {
    const clobberPrefix = 'doc-user-content-fn-decoy-user-content-';
    const tree = root(makeFooter([{ id: `${clobberPrefix}fn-a.b(1)`, bodyText: 'def x' }]));
    const bodies = extractDefBodiesFromHast(tree, clobberPrefix);
    expect(bodies.has('a.b(1)')).toBe(true);
    expect(bodies.has('decoy-user-content-fn-a.b(1)')).toBe(false);
  });

  test('sourceIdFromFootnoteLiId still decodes for DOM-side label matching', () => {
    expect(sourceIdFromFootnoteLiId('user-content-fn-%E4%B8%AD%E6%96%87')).toBe('中文');
    expect(sourceIdFromFootnoteLiId('doc-fn-a%25b', 'doc-')).toBe('a%b');
    expect(sourceIdFromFootnoteLiId('user-content-fn-a%41')).toBe('aA');
    expect(sourceIdFromFootnoteLiId('plain-id')).toBeNull();
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
    const liBody = bodies.get('x')!;
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

  test("only the footer's own `section > ol > li` items are harvested; a nested section or <li> in a body is content", () => {
    // `out.set` is last-write-wins. An author can write raw HTML inside a
    // definition body that survives rehype-raw + sanitize — a whole
    // `<section data-footnotes>`, or a bare `<li id="fn-x">` whose id
    // sanitize clobbers with the same prefix as the real footer's. A deep
    // visit harvested those too and let them stomp the real body of the
    // same label. Only direct list items of the footer's `<ol>` count.
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
    const bareLi: HastElement = {
      type: 'element',
      tagName: 'li',
      properties: { id: 'user-content-fn-outer' },
      children: [{ type: 'text', value: 'stomp' }],
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
            bareLi,
          ],
        },
      ],
    };
    const realX: HastElement = {
      type: 'element',
      tagName: 'li',
      properties: { id: 'user-content-fn-x' },
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'real x' }] }],
    };
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'section',
          properties: { dataFootnotes: true },
          children: [{ type: 'element', tagName: 'ol', properties: {}, children: [outerLi, realX] }],
        },
      ],
    };
    const bodies = extractDefBodiesFromHast(tree);
    expect([...bodies.keys()]).toEqual(['outer', 'x']);
    const outerP = bodies.get('outer')![0] as HastElement;
    expect((outerP.children[0] as { value: string }).value).toBe('before-nested ');
    // The nested section and the bare <li> stay inside the outer body.
    expect(outerP.children).toContain(nestedSection);
    expect(outerP.children).toContain(bareLi);
    const xP = bodies.get('x')![0] as HastElement;
    expect((xP.children[0] as { value: string }).value).toBe('real x');
  });

  test('first item wins when two footer items share an id (a raw <li> hoisted out of a body)', () => {
    // HTML parsing hoists `[^a]: real <li id="fn-a">stomp</li>` into a
    // second `<ol>` child with the generated id, right after the real item.
    const tree = root(
      makeFooter([
        { id: 'user-content-fn-a', bodyText: 'real' },
        { id: 'user-content-fn-a', bodyText: 'stomp' },
        { id: 'user-content-fn-b', bodyText: 'b' },
      ])
    );
    const bodies = extractDefBodiesFromHast(tree, 'user-content-');
    expect([...bodies.keys()]).toEqual(['a', 'b']);
    expect((bodies.get('a')![0] as HastElement).children[0]).toMatchObject({ value: 'real' });
  });

  test('an authored raw <section data-footnotes> (carries a source position) is not harvested', () => {
    // rehype-raw gives an author-written section a position; the footer
    // mdast-util-to-hast synthesizes has none. The shared `isFootnoteSection`
    // predicate keys on that conjunct, and the harvest applies the same rule
    // as the footer adorner and the block planner.
    const position = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 60, offset: 59 } };
    const authored: HastElement = {
      ...makeFooter([{ id: 'user-content-fn-zzz', bodyText: 'authored' }]),
      position,
    };
    const tree = root(authored, makeFooter([{ id: 'user-content-fn-a', bodyText: 'real' }]));
    const bodies = extractDefBodiesFromHast(tree, 'user-content-');
    expect([...bodies.keys()]).toEqual(['a']);
    // An authored section that reuses a real label must not win either.
    const stomp: HastElement = { ...makeFooter([{ id: 'user-content-fn-a', bodyText: 'stomp' }]), position };
    const bodies2 = extractDefBodiesFromHast(
      root(makeFooter([{ id: 'user-content-fn-a', bodyText: 'real' }]), stomp),
      'user-content-'
    );
    expect(JSON.stringify(bodies2.get('a'))).toContain('real');
    expect(JSON.stringify(bodies2.get('a'))).not.toContain('stomp');
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
