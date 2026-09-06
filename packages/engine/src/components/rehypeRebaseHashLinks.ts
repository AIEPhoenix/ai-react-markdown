/**
 * `rehypeRebaseHashLinks` — restore intra-document hash navigation after
 * `rehype-sanitize` clobbers `id` attributes.
 *
 * ### Why this exists
 *
 * `rehype-sanitize` defends against ID-clobbering attacks (e.g. a malicious
 * `<div id="window">` shadowing `window.window`) by prefixing every clobberable
 * attribute (`id`, `name`, `aria-describedby`, `aria-labelledby`) with
 * `clobberPrefix` (default `'user-content-'`). It does **not** rewrite `href`
 * values, since hashes are not themselves clobbering vectors. As a result,
 * any intra-document link — `[ref](#section)`, GFM footnote anchors, or raw
 * `<a id="x"><a href="#x">` pairs — points at an unprefixed hash while its
 * target id has been prefixed: navigation breaks.
 *
 * Pair this plugin with `remarkRehypeOptions: { clobberPrefix: '' }` so that
 * `mdast-util-to-hast` does not also prefix (avoiding `user-content-user-content-`
 * double prefixes), and place it **after** `rehype-sanitize` in the rehype
 * pipeline. The result mirrors GitHub's rendering: a single, consistent
 * `user-content-` prefix on every id and matching hash href.
 *
 * @module components/rehypeRebaseHashLinks
 */

import type { Root } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const DEFAULT_PREFIX = 'user-content-';

export function rebaseHashHref(href: string, prefix: string): string {
  const hashPrefix = '#' + prefix;
  return href.startsWith('#') && !href.startsWith(hashPrefix) ? hashPrefix + href.slice(1) : href;
}

export interface RehypeRebaseHashLinksOptions {
  /** Prefix to apply. Must match the `clobberPrefix` used by `rehype-sanitize`. */
  prefix?: string;
}

const rehypeRebaseHashLinks: Plugin<[RehypeRebaseHashLinksOptions?], Root> = (options) => {
  const prefix = options?.prefix ?? DEFAULT_PREFIX;
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string' || !href.startsWith('#')) return;
      node.properties.href = rebaseHashHref(href, prefix);
    });
  };
};

export default rehypeRebaseHashLinks;
