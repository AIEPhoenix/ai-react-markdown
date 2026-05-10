import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRegistry, type Registry } from './documentRegistry';
import { AggregateFootnotesIfLast } from './aggregateFootnotesIfLast';
import type { PostOptions } from './blockMemo';
import type { ElementContent as HastElementContent } from 'hast';

function pHast(text: string): HastElementContent {
  return {
    type: 'element',
    tagName: 'p',
    properties: {},
    children: [{ type: 'text', value: text }],
  };
}

function seedRegistry() {
  const reg: Registry = createRegistry();
  const a = reg.allocateSymbol('A');
  const b = reg.allocateSymbol('B');
  // chunk A: ref to X; chunk B: def for X, no ref
  reg.contributeChunkData(a, {
    refs: [{ label: 'X', kind: 'footnote' }],
    defs: new Map(),
    linkDefs: new Map(),
    ownFootnoteLabels: new Set(),
    ownLinkLabels: new Set(),
  });
  reg.contributeChunkData(b, {
    refs: [],
    defs: new Map([['X', { identifier: 'X', contentSource: 'hello', bodyHast: [pHast('hello')] }]]),
    linkDefs: new Map(),
    ownFootnoteLabels: new Set(['X']),
    ownLinkLabels: new Set(),
  });
  return { reg, a, b };
}

const baseOptions: PostOptions = { components: {} };

describe('AggregateFootnotesIfLast', () => {
  test('renders null when this chunk is not the last in chunkOrder', () => {
    const { reg, a } = seedRegistry();
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={a} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    expect(html).toBe('');
  });

  test('renders aggregate <section data-footnotes> when this chunk is last', () => {
    const { reg, b } = seedRegistry();
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={b} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    expect(html).toContain('data-footnotes');
    expect(html).toContain('<ol>');
    // <li value=1 id="doc-fn-X"> with body "hello" and backref pointing at doc-fnref-X.
    expect(html).toMatch(/<li[^>]+value="1"[^>]+id="doc-fn-X"|<li[^>]+id="doc-fn-X"[^>]+value="1"/);
    expect(html).toContain('hello');
    expect(html).toContain('href="#doc-fnref-X"');
    expect(html).toContain('↩');
  });

  test('names the section landmark via aria-label for a11y', () => {
    const { reg, b } = seedRegistry();
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={b} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    expect(html).toMatch(/<section[^>]+aria-label="Footnotes"/);
  });

  test('emits a separator <hr> before the footnote <ol>', () => {
    const { reg, b } = seedRegistry();
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={b} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    const hrIdx = html.indexOf('<hr');
    const olIdx = html.indexOf('<ol>');
    expect(hrIdx).toBeGreaterThan(-1);
    expect(olIdx).toBeGreaterThan(hrIdx);
  });

  test('renders null when there are no referenced defs', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={a} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    expect(html).toBe('');
  });

  test('appends orphan defs when orphan preservation is enabled', () => {
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map([
        [
          'X',
          {
            identifier: 'X',
            sourceIdentifier: 'x',
            contentSource: 'orphan',
            bodyHast: [pHast('orphan')],
          },
        ],
      ]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast
        registry={reg}
        thisChunkSym={a}
        clobberPrefix="doc-"
        postOptions={baseOptions}
        preserveOrphanReferences
      />
    );
    expect(html).toContain('id="doc-fn-x"');
    expect(html).toContain('orphan');
    expect(html).not.toContain('href="#doc-fnref-x"');
    expect(html).not.toContain('data-footnote-backref');
  });

  test('emits N backrefs when label has N footnote refs', () => {
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    // chunk A: 2 refs to X; chunk B: def for X + 1 more ref to X (3 total)
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
    reg.contributeChunkData(b, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map([
        ['X', { identifier: 'X', sourceIdentifier: 'x', contentSource: 'body', bodyHast: [pHast('body')] }],
      ]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={b} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    // First backref: bare fnref-x.
    expect(html).toContain('href="#doc-fnref-x"');
    // Second backref: fnref-x-2.
    expect(html).toContain('href="#doc-fnref-x-2"');
    // Third backref: fnref-x-3.
    expect(html).toContain('href="#doc-fnref-x-3"');
    // No fnref-x-4 (only 3 refs total).
    expect(html).not.toContain('href="#doc-fnref-x-4"');
    // First backref is just ↩ (no sup); subsequent emit ↩ + <sup>N</sup> so
    // the digit renders as a superscript (`↩²`) instead of flat `↩2`.
    expect(html).toMatch(/href="#doc-fnref-x"[^>]*>↩<\/a>/);
    expect(html).toMatch(/href="#doc-fnref-x-2"[^>]*>↩<sup>2<\/sup><\/a>/);
    expect(html).toMatch(/href="#doc-fnref-x-3"[^>]*>↩<sup>3<\/sup><\/a>/);
  });

  test('single-ref case still emits exactly one bare backref', () => {
    const { reg, b } = seedRegistry();
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={b} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    // Exactly one backref anchor in the output. Match `<a … href=…fnref-`
    // to avoid double-counting the className "data-footnote-backref" + the
    // attribute `data-footnote-backref=""`.
    const matches = html.match(/<a [^>]*href="#doc-fnref-X[^"]*"/g) ?? [];
    expect(matches.length).toBe(1);
    expect(html).toContain('href="#doc-fnref-X"');
    expect(html).not.toContain('href="#doc-fnref-X-2"');
  });

  test('numbers reflect first-occurrence order across chunks', () => {
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    // refs occur in order [Y, X] in chunk A; defs both in chunk B
    reg.contributeChunkData(a, {
      refs: [
        { label: 'Y', kind: 'footnote' },
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    reg.contributeChunkData(b, {
      refs: [],
      defs: new Map([
        ['X', { identifier: 'X', contentSource: 'x body', bodyHast: [pHast('x body')] }],
        ['Y', { identifier: 'Y', contentSource: 'y body', bodyHast: [pHast('y body')] }],
      ]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X', 'Y']),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={b} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    // Y appears first (value=1), X second (value=2). They should appear in that order.
    const yIdx = html.indexOf('doc-fn-Y');
    const xIdx = html.indexOf('doc-fn-X');
    expect(yIdx).toBeGreaterThan(-1);
    expect(xIdx).toBeGreaterThan(-1);
    expect(yIdx).toBeLessThan(xIdx);
    expect(html).toMatch(/value="1"[^>]*doc-fn-Y|doc-fn-Y[^>]*value="1"/);
    expect(html).toMatch(/value="2"[^>]*doc-fn-X|doc-fn-X[^>]*value="2"/);
  });

  test('uses def.sourceIdentifier (mdast case-folded) for <li id> and backref href', () => {
    // mdast normalizes footnote identifiers to lowercase, so a `[^Foo]` ref
    // ends up with sourceIdentifier='foo'. The aggregate footer's <li id>
    // and backref href must use 'foo' (matching mdast-util-to-hast's
    // convention and the inline sup's anchor href), NOT the
    // uppercase-normalized registry key 'FOO'.
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [{ label: 'FOO', kind: 'footnote' }],
      defs: new Map([
        [
          'FOO',
          {
            identifier: 'FOO',
            sourceIdentifier: 'foo',
            contentSource: 'body',
            bodyHast: [pHast('body')],
          },
        ],
      ]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['FOO']),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={a} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    expect(html).toContain('id="doc-fn-foo"'); // case-folded
    expect(html).toContain('href="#doc-fnref-foo"'); // case-folded
    expect(html).not.toContain('id="doc-fn-FOO"'); // not uppercase
    expect(html).not.toContain('href="#doc-fnref-FOO"'); // not uppercase
  });

  test('cross-chunk case collision: [^Foo] in chunk A resolves to [^FOO]: in chunk B', () => {
    // mdast normalizes both `[^Foo]` and `[^FOO]:` to identifier='foo', and
    // both extractContributions and customMdastHandlers apply normalizeId to
    // get the uppercase registry key 'FOO'. The aggregate footer must use
    // the (lowercase) sourceIdentifier for <li id>/backref href so it lines
    // up with the inline sup's anchor href across chunk boundaries. This
    // pins down the round-trip via the multi-chunk path; the single-chunk
    // case is covered by the test above.
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    reg.contributeChunkData(a, {
      refs: [{ label: 'FOO', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    reg.contributeChunkData(b, {
      refs: [],
      defs: new Map([
        [
          'FOO',
          {
            identifier: 'FOO',
            sourceIdentifier: 'foo',
            contentSource: 'def body',
            bodyHast: [pHast('def body')],
          },
        ],
      ]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['FOO']),
      ownLinkLabels: new Set(),
    });
    // Number resolves across chunks.
    expect(reg.globalNumber('FOO')).toBe(1);
    expect(reg.canonicalFootnoteFor('FOO')).toBe(b);
    // Footer uses the case-folded sourceIdentifier — matching what the
    // inline <footnote-sup>'s anchor href ends up containing in chunk A.
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={b} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    expect(html).toContain('id="doc-fn-foo"');
    expect(html).toContain('href="#doc-fnref-foo"');
    expect(html).toContain('def body');
  });

  test('appends backref AFTER trailing non-<p> block (multi-block def)', () => {
    // A footnote def whose body has a trailing <pre> (or <blockquote>, etc.)
    // should get the backref AFTER the <pre>, not nested inside an earlier
    // <p>. mdast-util-to-hast's rule: tail is <p> → push into it; else
    // push into <li> directly. The previous findLastParagraphIdx scanned
    // for the LAST <p> anywhere in the body, putting the backref before
    // the trailing <pre> for `[<p>text</p>, <pre>code</pre>]` shapes.
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    const codeBlock: HastElementContent = {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: 'code' }] }],
    };
    reg.contributeChunkData(a, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map([
        [
          'X',
          {
            identifier: 'X',
            sourceIdentifier: 'x',
            contentSource: 'body',
            bodyHast: [pHast('intro'), codeBlock],
          },
        ],
      ]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={a} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    // The backref's href must appear AFTER the closing </pre>, not inside <p>.
    const preEnd = html.indexOf('</pre>');
    const backrefAnchor = html.indexOf('href="#doc-fnref-x"');
    expect(preEnd).toBeGreaterThan(-1);
    expect(backrefAnchor).toBeGreaterThan(preEnd);
    // The intro <p> must NOT contain the backref anchor.
    const pStart = html.indexOf('<p>');
    const pEnd = html.indexOf('</p>');
    const pSlice = html.slice(pStart, pEnd);
    expect(pSlice).not.toContain('data-footnote-backref');
  });

  test('appends backref INTO trailing <p> when it IS the tail (case A, with wrap whitespace)', () => {
    // Sanity check: when the body's meaningful tail IS a <p> — even when
    // wrap-emitted `\n` text nodes surround it — the backref still goes
    // INSIDE the <p>, matching mdast-util-to-hast's contract.
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    const wrappedBody: HastElementContent[] = [
      { type: 'text', value: '\n' },
      pHast('hello'),
      { type: 'text', value: '\n' },
    ];
    reg.contributeChunkData(a, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map([
        [
          'X',
          {
            identifier: 'X',
            sourceIdentifier: 'x',
            contentSource: 'body',
            bodyHast: wrappedBody,
          },
        ],
      ]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={a} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    // Backref lives INSIDE <p>...</p>, not after it.
    expect(html).toMatch(/<p>hello\s*<a[^>]*href="#doc-fnref-x"/);
  });

  test('falls back to empty bodyHast when def.bodyHast is missing (defensive)', () => {
    const reg: Registry = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map([['X', { identifier: 'X', contentSource: 'no hast' }]]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    const html = renderToStaticMarkup(
      <AggregateFootnotesIfLast registry={reg} thisChunkSym={a} clobberPrefix="doc-" postOptions={baseOptions} />
    );
    // <li> exists but with no body content other than the backref.
    expect(html).toContain('doc-fn-X');
    expect(html).toContain('href="#doc-fnref-X"');
  });
});
