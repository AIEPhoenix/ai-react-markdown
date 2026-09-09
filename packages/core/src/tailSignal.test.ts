import { describe, expect, test } from 'vitest';
import type { Root } from 'mdast';
import { deriveTailSignal } from './tailSignal';
const pos = (startOffset: number) => ({
  start: { line: 1, column: 1, offset: startOffset },
  end: { line: 1, column: 2, offset: startOffset + 1 },
});

describe('deriveTailSignal — mdast mechanics', () => {
  test('classifies a trailing footnote definition', () => {
    const mdast = {
      type: 'root',
      children: [
        { type: 'paragraph', position: pos(0), children: [{ type: 'text', value: 'body' }] },
        { type: 'footnoteDefinition', identifier: 'a', position: pos(6), children: [] },
      ],
    } as unknown as Root;
    expect(deriveTailSignal(mdast, 100)).toEqual({ kind: 'footnote-def', identifier: 'a' });
  });

  test('body tail yields null; link definition yields invisible-def', () => {
    const body = {
      type: 'root',
      children: [{ type: 'paragraph', position: pos(0), children: [] }],
    } as unknown as Root;
    expect(deriveTailSignal(body, 100)).toBeNull();
    const linkDef = {
      type: 'root',
      children: [{ type: 'definition', identifier: 'x', position: pos(0) }],
    } as unknown as Root;
    expect(deriveTailSignal(linkDef, 100)).toEqual({ kind: 'invisible-def' });
  });

  test('scans backwards past ALL phantom-suffix nodes (offset ≥ content length)', () => {
    // A real trailing def plus several phantoms is a normal coordinated
    // shape — filtering only the last child would misclassify.
    const mdast = {
      type: 'root',
      children: [
        { type: 'footnoteDefinition', identifier: 'real', position: pos(0), children: [] },
        { type: 'paragraph', position: pos(11), children: [] }, // phantom ref para
        { type: 'footnoteDefinition', identifier: 'ph1', position: pos(20), children: [] },
        { type: 'footnoteDefinition', identifier: 'ph2', position: pos(30), children: [] },
      ],
    } as unknown as Root;
    expect(deriveTailSignal(mdast, 11)).toEqual({ kind: 'footnote-def', identifier: 'real' });
  });

  test('all-phantom trees classify as null (empty gated chunk with injections)', () => {
    const mdast = {
      type: 'root',
      children: [{ type: 'footnoteDefinition', identifier: 'ph', position: pos(0), children: [] }],
    } as unknown as Root;
    expect(deriveTailSignal(mdast, 0)).toBeNull();
  });

  test('descends containers and keeps the DEEPEST definition (def nested in def body)', () => {
    const mdast = {
      type: 'root',
      children: [
        {
          type: 'footnoteDefinition',
          identifier: 'outer',
          position: pos(0),
          children: [
            { type: 'paragraph', children: [] },
            { type: 'footnoteDefinition', identifier: 'inner', position: pos(5), children: [] },
          ],
        },
      ],
    } as unknown as Root;
    expect(deriveTailSignal(mdast, 100)).toEqual({ kind: 'footnote-def', identifier: 'inner' });
  });

  test('descends blockquote and list containers', () => {
    const inBlockquote = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          position: pos(0),
          children: [{ type: 'footnoteDefinition', identifier: 'q', children: [] }],
        },
      ],
    } as unknown as Root;
    expect(deriveTailSignal(inBlockquote, 100)).toEqual({ kind: 'footnote-def', identifier: 'q' });
    const inList = {
      type: 'root',
      children: [
        {
          type: 'list',
          position: pos(0),
          children: [
            {
              type: 'listItem',
              children: [{ type: 'footnoteDefinition', identifier: 'l', children: [] }],
            },
          ],
        },
      ],
    } as unknown as Root;
    expect(deriveTailSignal(inList, 100)).toEqual({ kind: 'footnote-def', identifier: 'l' });
  });

  test('a link definition as the last child of a footnote def body is invisible', () => {
    const mdast = {
      type: 'root',
      children: [
        {
          type: 'footnoteDefinition',
          identifier: 'a',
          position: pos(0),
          children: [{ type: 'definition', identifier: 'url' }],
        },
      ],
    } as unknown as Root;
    expect(deriveTailSignal(mdast, 100)).toEqual({ kind: 'invisible-def' });
  });

  test('empty root yields null', () => {
    expect(deriveTailSignal({ type: 'root', children: [] } as unknown as Root, 0)).toBeNull();
  });
});
