import { describe, expect, test } from 'vitest';
import { detectAnchorTextNode } from './detectAnchor';

// The detector touches only a structural slice of the DOM (nodeType,
// childNodes, tagName, classList.contains, hasAttribute, getAttribute,
// data), so the walk is exercised here with plain-object fakes under the
// node environment. Real-layout behavior (Range rects, positioning) is
// covered by the StreamingCursor Storybook smoke in the browser project.

interface FakeNode {
  nodeType: number;
  childNodes: FakeNode[];
}

interface FakeText extends FakeNode {
  data: string;
}

interface FakeElement extends FakeNode {
  tagName: string;
  classList: { contains: (name: string) => boolean };
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
}

function text(data: string): FakeText {
  return { nodeType: 3, childNodes: [], data };
}

function comment(): FakeNode {
  return { nodeType: 8, childNodes: [] };
}

function el(
  tag: string,
  children: FakeNode[] = [],
  opts: { attrs?: Record<string, string>; classes?: string[] } = {}
): FakeElement {
  const { attrs = {}, classes = [] } = opts;
  return {
    nodeType: 1,
    childNodes: children,
    tagName: tag.toUpperCase(),
    classList: { contains: (name) => classes.includes(name) },
    hasAttribute: (name) => name in attrs,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
  };
}

function detect(root: FakeElement, exclude: FakeElement | null = null): FakeText | null {
  return detectAnchorTextNode(
    root as unknown as Element,
    exclude as unknown as Element | null
  ) as unknown as FakeText | null;
}

describe('detectAnchorTextNode', () => {
  test('anchors to the text of a trailing paragraph', () => {
    const root = el('div', [el('p', [text('hello')])]);
    expect(detect(root)?.data).toBe('hello');
  });

  test('descends through nested safe containers (list, inline formatting)', () => {
    const root = el('div', [el('ul', [el('li', [text('a')]), el('li', [el('strong', [text('b')])])])]);
    expect(detect(root)?.data).toBe('b');
  });

  test('descends into table cells', () => {
    const root = el('div', [el('table', [el('tbody', [el('tr', [el('td', [text('cell')])])])])]);
    expect(detect(root)?.data).toBe('cell');
  });

  test('descends into blockquote paragraphs', () => {
    const root = el('div', [el('blockquote', [el('p', [text('quoted')])])]);
    expect(detect(root)?.data).toBe('quoted');
  });

  test('skips whitespace-only text nodes between blocks', () => {
    const root = el('div', [el('p', [text('hi')]), text('\n')]);
    expect(detect(root)?.data).toBe('hi');
  });

  test('skips comment nodes inside a host', () => {
    const root = el('div', [el('p', [text('hi'), comment()])]);
    expect(detect(root)?.data).toBe('hi');
  });

  test('hides on a trailing fenced code block (pre/code unsafe)', () => {
    const root = el('div', [el('p', [text('hi')]), el('pre', [el('code', [text('const x = 1;')])])]);
    expect(detect(root)).toBeNull();
  });

  test('hides on trailing inline code (code unsafe)', () => {
    const root = el('div', [el('p', [text('run '), el('code', [text('npm i')])])]);
    expect(detect(root)).toBeNull();
  });

  test('hides on KaTeX output even though it is span-based', () => {
    const root = el('div', [el('p', [el('span', [text('x')], { classes: ['katex'] })])]);
    expect(detect(root)).toBeNull();
  });

  test('allows non-KaTeX spans (typography helpers wrap prose in spans)', () => {
    const root = el('div', [el('p', [el('span', [text('spaced')])])]);
    expect(detect(root)?.data).toBe('spaced');
  });

  test('hides on trailing svg (rendered mermaid)', () => {
    const root = el('div', [el('svg', [text('diagram')])]);
    expect(detect(root)).toBeNull();
  });

  test('real-DOM svg reports a LOWERCASE tagName and must still be rejected', () => {
    // `el()` uppercases its tag, but SVG-namespace elements keep lowercase
    // tagName in the real DOM. Hand-build the fake to pin the real-DOM
    // contract: the whitelist must stay case-sensitive — a case-insensitive
    // "cleanup" would admit foreign-namespace elements whose lowercase
    // names uppercase into whitelisted ones (SVG <a> → 'A').
    const svg: FakeElement = {
      nodeType: 1,
      childNodes: [text('diagram')],
      tagName: 'svg',
      classList: { contains: () => false },
      hasAttribute: () => false,
      getAttribute: () => null,
    };
    const root = el('div', [svg]);
    expect(detect(root)).toBeNull();
  });

  test('hides on unknown elements from raw HTML (whitelist descent)', () => {
    const root = el('div', [el('p', [el('custom-tag', [text('z')])])]);
    expect(detect(root)).toBeNull();
  });

  test('hides on trailing void elements (hr)', () => {
    const root = el('div', [el('p', [text('hi')]), el('hr')]);
    expect(detect(root)).toBeNull();
  });

  test('hides on an empty root (waiting for the first token)', () => {
    const root = el('div', []);
    expect(detect(root)).toBeNull();
  });

  test('hides on an empty trailing paragraph', () => {
    const root = el('div', [el('p', [])]);
    expect(detect(root)).toBeNull();
  });

  test('skips the footnote section — the cursor marks the end of the body', () => {
    const root = el('div', [
      el('p', [text('body')]),
      el('section', [el('ol', [el('li', [text('note')])])], { attrs: { 'data-footnotes': '' } }),
    ]);
    expect(detect(root)?.data).toBe('body');
  });

  test('skips the excluded shell wrapper', () => {
    const wrapper = el('span');
    const root = el('div', [el('p', [text('body')]), wrapper]);
    expect(detect(root, wrapper)?.data).toBe('body');
  });

  test('non-footnote sections are not entered (unknown at whitelist level)', () => {
    const root = el('div', [el('section', [el('p', [text('x')])])]);
    expect(detect(root)).toBeNull();
  });
});

/** Footer with two lis (standalone id shape) plus a body paragraph. */
function footerFixture(lis: FakeNode[]): FakeElement[] {
  return [
    el('p', [text('body')]),
    el('section', [el('h2', [text('Footnotes')]), el('ol', lis)], { attrs: { 'data-footnotes': '' } }),
  ];
}

function marker(attrs: Record<string, string>): FakeElement {
  return el('span', [], { attrs: { 'data-aimd-tail-kind': 'footnote-def', ...attrs } });
}

describe('detectAnchorTextNode — tail-marker (definition streaming) mode', () => {
  test('targets the RIGHT li by label, not the last li (out-of-order references)', () => {
    // [^a] referenced first → its li is FIRST while [^b]'s completed def
    // sits last. The streaming def is [^a]; "last li" would mis-anchor.
    const root = el('div', [
      ...footerFixture([
        el('li', [el('p', [text('a is streaming')])], { attrs: { id: 'user-content-fn-a' } }),
        el('li', [el('p', [text('b done')])], { attrs: { id: 'user-content-fn-b' } }),
      ]),
      marker({ 'data-aimd-tail-label': 'a' }),
    ]);
    expect(detect(root)?.data).toBe('a is streaming');
  });

  test('skips the backref link INSIDE the trailing paragraph (case B)', () => {
    const root = el('div', [
      ...footerFixture([
        el(
          'li',
          [el('p', [text('def text'), text(' '), el('a', [text('↩')], { attrs: { 'data-footnote-backref': '' } })])],
          { attrs: { id: 'user-content-fn-a' } }
        ),
      ]),
      marker({ 'data-aimd-tail-label': 'a' }),
    ]);
    expect(detect(root)?.data).toBe('def text');
  });

  test('skips a backref sitting directly at the li tail (case A)', () => {
    const root = el('div', [
      ...footerFixture([
        el('li', [el('p', [text('def text')]), el('a', [text('↩')], { attrs: { 'data-footnote-backref': '' } })], {
          attrs: { id: 'user-content-fn-a' },
        }),
      ]),
      marker({ 'data-aimd-tail-label': 'a' }),
    ]);
    expect(detect(root)?.data).toBe('def text');
  });

  test('hides when the target li is absent (aggregate footer in another chunk, unreferenced def)', () => {
    const root = el('div', [
      ...footerFixture([el('li', [el('p', [text('b')])], { attrs: { id: 'user-content-fn-b' } })]),
      marker({ 'data-aimd-tail-label': 'a' }),
    ]);
    expect(detect(root)).toBeNull();
  });

  test('hides when no footer exists at all', () => {
    const root = el('div', [el('p', [text('body')]), marker({ 'data-aimd-tail-label': 'a' })]);
    expect(detect(root)).toBeNull();
  });

  test('invisible-def tail (link reference definition) hides the cursor', () => {
    const root = el('div', [
      el('p', [text('body')]),
      el('span', [], { attrs: { 'data-aimd-tail-kind': 'invisible-def' } }),
    ]);
    expect(detect(root)).toBeNull();
  });

  test('custom clobber prefix resolves via the exact-slice tier', () => {
    const root = el('div', [
      ...footerFixture([el('li', [el('p', [text('custom')])], { attrs: { id: 'pfx-fn-a' } })]),
      marker({ 'data-aimd-tail-label': 'a', 'data-aimd-clobber-prefix': 'pfx-' }),
    ]);
    expect(detect(root)?.data).toBe('custom');
  });

  test('label matching is case-insensitive via normalizeId (mdast case-folds)', () => {
    const root = el('div', [
      ...footerFixture([el('li', [el('p', [text('folded')])], { attrs: { id: 'user-content-fn-abc' } })]),
      marker({ 'data-aimd-tail-label': 'AbC' }),
    ]);
    expect(detect(root)?.data).toBe('folded');
  });

  test('percent-encoded li ids (normalizeUri output) decode before matching', () => {
    const root = el('div', [
      ...footerFixture([el('li', [el('p', [text('cjk')])], { attrs: { id: 'user-content-fn-%E4%B8%AD' } })]),
      marker({ 'data-aimd-tail-label': '中' }),
    ]);
    expect(detect(root)?.data).toBe('cjk');
  });

  test('an unknown marker kind falls through to the default body walk', () => {
    const root = el('div', [
      el('p', [text('body')]),
      el('span', [], { attrs: { 'data-aimd-tail-kind': 'future-kind' } }),
    ]);
    expect(detect(root)?.data).toBe('body');
  });

  test('the marker itself is never an anchor candidate in the default walk', () => {
    // Marker with text content (should never happen, but the walk must not
    // anchor to it) sitting after the body.
    const root = el('div', [
      el('p', [text('body')]),
      el('span', [text('ghost')], { attrs: { 'data-aimd-tail-kind': 'future-kind' } }),
    ]);
    expect(detect(root)?.data).toBe('body');
  });

  test('code inside the streaming definition hides (whitelist policy unchanged in the footer)', () => {
    const root = el('div', [
      ...footerFixture([el('li', [el('pre', [el('code', [text('x')])])], { attrs: { id: 'user-content-fn-a' } })]),
      marker({ 'data-aimd-tail-label': 'a' }),
    ]);
    expect(detect(root)).toBeNull();
  });
});
