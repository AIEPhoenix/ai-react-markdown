/**
 * Integration tests for `rehypeRebaseHashLinks` and the surrounding
 * `MarkdownContent` pipeline. These lock in the contract that intra-document
 * hash navigation survives `rehype-sanitize`'s id clobbering with a single,
 * clean `user-content-` prefix.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import AIMarkdown, { extendSanitizeSchema } from '../index';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import type { Element, Root } from 'hast';

// Pin a deterministic documentId across the integration tests so we can
// assert on stable id/href strings. The auto-generated `useId()` value is
// covered separately by the multi-document test below.
const TEST_DOCUMENT = 'tst';

function render(md: string, documentId: string = TEST_DOCUMENT) {
  return renderToStaticMarkup(<AIMarkdown content={md} documentId={documentId} />);
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

    // No prefix segment should ever appear twice (double-prefix bug).
    expect(html).not.toMatch(/tst-user-content-tst-user-content-/);
    expect(html).not.toMatch(/user-content-user-content-/);
    const idSet = new Set(ids);
    for (const href of hrefs) {
      expect(idSet.has(href.slice(1))).toBe(true);
    }
    // Every id/href that survives sanitize must carry the document prefix.
    for (const id of ids) {
      expect(id.startsWith(`${TEST_DOCUMENT}-user-content-`)).toBe(true);
    }
  });

  test('raw HTML <h2 id="foo"> + markdown link [link](#foo) navigate', () => {
    const html = render('<h2 id="foo">Hello</h2>\n\n[goto](#foo)');
    expect(html).toContain(`id="${TEST_DOCUMENT}-user-content-foo"`);
    expect(html).toContain(`href="#${TEST_DOCUMENT}-user-content-foo"`);
    expect(html).not.toMatch(/user-content-user-content-/);
  });

  test('clobber-vector ids like id="window" still get prefixed for safety', () => {
    const html = render('<div id="window">x</div>\n\n[link](#window)');
    expect(html).toContain(`id="${TEST_DOCUMENT}-user-content-window"`);
    expect(html).toContain(`href="#${TEST_DOCUMENT}-user-content-window"`);
  });

  test('external URL hashes are not rebased', () => {
    const html = render('[ext](https://example.com#section)');
    expect(html).toContain('href="https://example.com#section"');
    expect(html).not.toContain('user-content-');
  });

  test('two documents with different documentIds do not share id prefixes', () => {
    const htmlA = render('See[^x].\n\n[^x]: a', 'doc-a');
    const htmlB = render('See[^x].\n\n[^x]: b', 'doc-b');

    expect(htmlA).toContain('doc-a-user-content-');
    expect(htmlA).not.toContain('doc-b-user-content-');
    expect(htmlB).toContain('doc-b-user-content-');
    expect(htmlB).not.toContain('doc-a-user-content-');
  });

  test('library clobberPrefix wins over a caller-supplied schema clobberPrefix', () => {
    // The default rehypePlugins spread is `{ ...usedSanitizeSchema, clobberPrefix }`
    // — the library's `${documentId}-user-content-` is appended LAST so it
    // overrides any `clobberPrefix` baked into the caller's schema. This
    // invariant is what keeps `rehypeRebaseHashLinks` and `rehype-sanitize`
    // aligned on a single prefix (the renamed "double-prefix" bug returns
    // immediately if the order ever flips). Pin it explicitly so a future
    // refactor of the spread can't silently regress the contract.
    const HOSTILE_SCHEMA = extendSanitizeSchema((s) => {
      // Force a different clobberPrefix on the caller's schema. The pipeline
      // must IGNORE this value and use the documentId-derived prefix.
      (s as unknown as { clobberPrefix: string }).clobberPrefix = 'totally-wrong-';
    });

    const html = renderToStaticMarkup(
      <AIMarkdown
        content="<h2 id='foo'>x</h2>\n\n[goto](#foo)"
        documentId={TEST_DOCUMENT}
        sanitizeSchema={HOSTILE_SCHEMA}
      />
    );

    // No id or href should carry the hostile prefix.
    expect(html).not.toContain('totally-wrong-');
    // Real ids/hrefs MUST use the documentId-derived prefix.
    expect(html).toContain(`${TEST_DOCUMENT}-user-content-foo`);
  });

  test('extendSanitizeSchema with custom clobberPrefix is also overridden', () => {
    // Same invariant as the hostile schema test, but expressed via the
    // canonical `extendSanitizeSchema` path — proves the spread order in
    // the pipeline does NOT depend on how the schema was constructed.
    const draftWithBadPrefix = extendSanitizeSchema((s) => {
      (s as unknown as { clobberPrefix: string }).clobberPrefix = 'x-';
    });
    const html = renderToStaticMarkup(
      <AIMarkdown
        content="<h2 id='bar'>y</h2>"
        documentId={TEST_DOCUMENT}
        sanitizeSchema={draftWithBadPrefix}
      />
    );
    expect(html).not.toContain('x-bar');
    expect(html).toContain(`${TEST_DOCUMENT}-user-content-bar`);
  });

  test('auto-generated documentId becomes URI-encoded in the prefix', () => {
    // Render without an explicit documentId; useId() output flows through
    // `encodeURIComponent` at the prefix construction site, so any reserved
    // character (e.g. `:` if React ever reverts to `:r0:` style) shows up
    // percent-encoded inside the id attribute — never raw, never empty.
    const html = renderToStaticMarkup(<AIMarkdown content="<h2 id='foo'>x</h2>" />);
    const { ids } = extractIdsAndHrefs(html);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      // The prefix segment must be non-empty (encodeURIComponent of any
      // non-empty string yields a non-empty result) and the suffix must be
      // the original clobber form derived from the source `id="foo"`.
      expect(id).toMatch(/^[A-Za-z0-9%_-]+-user-content-foo$/);
    }
  });
});

describe('rehypeRebaseHashLinks (unit, plugin in isolation)', () => {
  function makeAnchor(properties: Element['properties']): Element {
    return { type: 'element', tagName: 'a', properties, children: [] };
  }

  function runPlugin(anchor: Element, prefix?: string) {
    const tree: Root = { type: 'root', children: [anchor] };
    // `rehypeRebaseHashLinks` is typed as a unified `Plugin`, which expects
    // a Processor `this`. Calling it directly as a free function for unit
    // testing requires sidestepping that `this`-binding check; cast to a
    // direct factory shape.
    const factory = rehypeRebaseHashLinks as unknown as (options?: {
      prefix?: string;
    }) => ((tree: Root, file: unknown) => void) | undefined;
    const transformer = factory(prefix ? { prefix } : undefined);
    transformer?.(tree, {} as never);
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
