/**
 * Provenance verifier for the engine's internal placeholder elements.
 *
 * The cross-chunk handlers (`customMdastHandlers.ts`) emit three custom hast
 * elements — `footnote-sup`, `cross-chunk-link`, `cross-chunk-image` — that
 * the sanitize schema must admit so they can reach their React placeholders.
 * Admitting the tag names admits them from AUTHORED raw HTML too: a document
 * can write `<footnote-sup label="a">` and, after `rehypeRaw` + sanitize, it
 * arrives at the placeholder with a `label`, takes the `fnref-a` anchor the
 * footer's backref points to, and pollutes the block dependency sets.
 *
 * Two layers tell a genuine instance from a forged one:
 *
 * 1. The property-NAME channel. `hast-util-raw` re-emits existing element
 *    nodes as parser tokens without passing the tokenizer, so a camelCase
 *    property written by a handler survives verbatim; authored raw HTML goes
 *    through the tokenizer and every attribute name comes back lowercased
 *    (`engineProvenance="x"` → `engineprovenance`). Authored HTML therefore
 *    cannot produce the property this plugin reads. (Pinned in the test.)
 * 2. The property VALUE: a per-pipeline credential the handlers stamp and
 *    this plugin checks, so a future upstream change that preserved authored
 *    attribute case would still leave the value to guess.
 *
 * Runs after `rehypeRaw` and before `rehypeSanitize` (see `pluginChain.ts`):
 * genuine instances lose the credential and pass; every other instance is
 * unwrapped — replaced by its children, removed when it has none — which is
 * what `hast-util-sanitize` does to a disallowed element.
 *
 * The walk is index-controlled on purpose. `unist-util-visit` with a splice
 * in the visitor is easy to get wrong (returning SKIP or an index after
 * replacing a node skips the first exposed child or revisits a sibling); an
 * explicit loop that does not advance after a splice inspects the exposed
 * children next, so forged-wrapping-genuine, genuine-wrapping-forged,
 * forged-inside-forged and adjacent forged instances all resolve.
 *
 * @module components/rehypeVerifyEngineTags
 */
import type { Root, Element, RootContent, ElementContent } from 'hast';

/** The three placeholder tag names the handlers emit. Keep in sync with the
 *  sanitize schema's `crossChunkTags` and core's `PLACEHOLDER_TAGS`. */
export const ENGINE_PLACEHOLDER_TAGS: ReadonlySet<string> = new Set([
  'footnote-sup',
  'cross-chunk-link',
  'cross-chunk-image',
]);

/** The property the handlers stamp. camelCase is load-bearing (layer 1). */
export const ENGINE_PROVENANCE_PROPERTY = 'engineProvenance';

export interface RehypeVerifyEngineTagsOptions {
  /** The credential the handlers were given. The empty string accepts
   *  nothing (fail closed); it is never a valid credential. */
  provenance: string;
}

type Parent = Root | Element;

function walk(parent: Parent, provenance: string): void {
  const children = parent.children as Array<RootContent | ElementContent>;
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.type === 'element' && ENGINE_PLACEHOLDER_TAGS.has(node.tagName)) {
      const props = node.properties ?? {};
      const stamped = props[ENGINE_PROVENANCE_PROPERTY];
      const genuine = provenance !== '' && typeof stamped === 'string' && stamped === provenance;
      if (genuine) {
        delete props[ENGINE_PROVENANCE_PROPERTY];
        walk(node, provenance);
        i += 1;
      } else {
        // Unwrap: the exposed children (possibly none) now sit at `i` and
        // are inspected on the next iteration — do NOT advance.
        children.splice(i, 1, ...node.children);
      }
      continue;
    }
    if (node.type === 'element') walk(node, provenance);
    i += 1;
  }
}

/**
 * rehype plugin: strip the provenance credential from genuine engine
 * placeholders and unwrap every placeholder that lacks it.
 */
export function rehypeVerifyEngineTags(options: RehypeVerifyEngineTagsOptions) {
  const provenance = options?.provenance ?? '';
  return function transformer(tree: Root): void {
    walk(tree, provenance);
  };
}

export default rehypeVerifyEngineTags;
