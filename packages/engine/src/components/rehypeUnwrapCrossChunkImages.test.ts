/**
 * `rehypeUnwrapCrossChunkImages` — the placeholder mirror of
 * rehype-unwrap-images. Both placeholder legs must unwrap (v2.4.1 review:
 * the guard only looked for the image placeholder, so `[![pic](url)][ref]`
 * stayed wrapped in coordinated mode while standalone unwrapped it).
 */
import { describe, expect, test } from 'vitest';
import type { Element, Root, RootContent } from 'hast';
import { rehypeUnwrapCrossChunkImages } from './rehypeUnwrapCrossChunkImages';

const el = (tagName: string, children: RootContent[] = []): Element => ({
  type: 'element',
  tagName,
  properties: {},
  children: children as Element['children'],
});
const p = (...children: RootContent[]): Element => el('p', children);
const text = (value: string): RootContent => ({ type: 'text', value });

function run(...children: RootContent[]): string[] {
  const tree: Root = { type: 'root', children };
  rehypeUnwrapCrossChunkImages()(tree);
  return tree.children.map((c) => (c.type === 'element' ? c.tagName : c.type));
}

describe('rehypeUnwrapCrossChunkImages', () => {
  test('image placeholder alone in a paragraph is unwrapped', () => {
    expect(run(p(el('cross-chunk-image')))).toEqual(['cross-chunk-image']);
    expect(run(p(text(' '), el('cross-chunk-image'), text('\n')))).toEqual(['text', 'cross-chunk-image', 'text']);
  });

  test('link placeholder wrapping a plain <img> is unwrapped (the link leg)', () => {
    expect(run(p(el('cross-chunk-link', [el('img')])))).toEqual(['cross-chunk-link']);
    expect(run(p(el('cross-chunk-link', [el('cross-chunk-image')])))).toEqual(['cross-chunk-link']);
    expect(run(p(el('a', [el('cross-chunk-image')])))).toEqual(['a']);
  });

  test('paragraphs without any placeholder are left to rehype-unwrap-images', () => {
    expect(run(p(el('img')))).toEqual(['p']);
    expect(run(p(el('a', [el('img')])))).toEqual(['p']);
  });

  test('other content keeps the paragraph', () => {
    expect(run(p(el('cross-chunk-image'), text('caption')))).toEqual(['p']);
    expect(run(p(el('cross-chunk-link', [text('label')])))).toEqual(['p']);
    expect(run(p(el('cross-chunk-link', [el('img'), text('x')])))).toEqual(['p']);
    // A link inside a link never unwraps (rehype-unwrap-images rule).
    expect(run(p(el('cross-chunk-link', [el('a', [el('img')])])))).toEqual(['p']);
  });
});
