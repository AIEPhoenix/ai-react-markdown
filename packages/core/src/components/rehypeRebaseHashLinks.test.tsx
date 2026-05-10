/**
 * Integration tests for `rehypeRebaseHashLinks` and the surrounding
 * `MarkdownContent` pipeline. These lock in the contract that intra-document
 * hash navigation survives `rehype-sanitize`'s id clobbering with a single,
 * clean `user-content-` prefix.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import AIMarkdown from '../index';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import type { Element, Root } from 'hast';

function render(md: string) {
  return renderToStaticMarkup(<AIMarkdown content={md} />);
}

function extractIdsAndHrefs(html: string) {
  return {
    ids: [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]),
    hrefs: [...html.matchAll(/href="(#[^"]+)"/g)].map((m) => m[1]),
  };
}

describe('rehypeRebaseHashLinks (integration with full AIMarkdown pipeline)', () => {
  test('GFM footnote forward and back references both navigate correctly', () => {
    const html = render('See[^x].\n\n[^x]: hello world');
    const { ids, hrefs } = extractIdsAndHrefs(html);

    expect(html).not.toMatch(/user-content-user-content-/);
    const idSet = new Set(ids);
    for (const href of hrefs) {
      expect(idSet.has(href.slice(1))).toBe(true);
    }
  });

  test('raw HTML <h2 id="foo"> + markdown link [link](#foo) navigate', () => {
    const html = render('<h2 id="foo">Hello</h2>\n\n[goto](#foo)');
    expect(html).toContain('id="user-content-foo"');
    expect(html).toContain('href="#user-content-foo"');
    expect(html).not.toMatch(/user-content-user-content-/);
  });

  test('clobber-vector ids like id="window" still get prefixed for safety', () => {
    const html = render('<div id="window">x</div>\n\n[link](#window)');
    expect(html).toContain('id="user-content-window"');
    expect(html).toContain('href="#user-content-window"');
  });

  test('external URL hashes are not rebased', () => {
    const html = render('[ext](https://example.com#section)');
    expect(html).toContain('href="https://example.com#section"');
    expect(html).not.toContain('user-content-');
  });
});

describe('rehypeRebaseHashLinks (unit, plugin in isolation)', () => {
  function makeAnchor(properties: Element['properties']): Element {
    return { type: 'element', tagName: 'a', properties, children: [] };
  }

  function runPlugin(anchor: Element, prefix?: string) {
    const tree: Root = { type: 'root', children: [anchor] };
    const transformer = rehypeRebaseHashLinks(prefix ? { prefix } : undefined);
    transformer(tree, undefined as never);
    return anchor.properties?.href;
  }

  test('rewrites bare hash hrefs', () => {
    expect(runPlugin(makeAnchor({ href: '#foo' }))).toBe('#user-content-foo');
  });

  test('skips hrefs already prefixed', () => {
    expect(runPlugin(makeAnchor({ href: '#user-content-foo' }))).toBe('#user-content-foo');
  });

  test('leaves non-hash hrefs alone', () => {
    expect(runPlugin(makeAnchor({ href: 'https://x.com' }))).toBe('https://x.com');
  });

  test('leaves anchors without href alone', () => {
    const anchor = makeAnchor({ id: 'anchor' });
    runPlugin(anchor);
    expect(anchor.properties?.href).toBeUndefined();
  });

  test('respects custom prefix option', () => {
    expect(runPlugin(makeAnchor({ href: '#x' }), 'safe-')).toBe('#safe-x');
  });

  test('does not touch non-anchor elements', () => {
    const div: Element = {
      type: 'element',
      tagName: 'div',
      properties: { href: '#foo' },
      children: [],
    };
    runPlugin(div);
    expect(div.properties?.href).toBe('#foo');
  });
});
