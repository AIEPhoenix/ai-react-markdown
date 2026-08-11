/**
 * Single-pass hast tree transform: rewrites raw HTML, runs `urlTransform` on
 * URL attributes, and applies `allowedElements` / `disallowedElements` /
 * `allowElement` filters. Ported 1:1 from react-markdown v10.
 *
 * @module components/markdown/transform
 */

import type { Element, Root } from 'hast';
import { urlAttributes } from 'html-url-attributes';
import type { BuildVisitor } from 'unist-util-visit';
import type { AllowElement, UrlTransform } from './types';

export interface TransformContext {
  allowedElements: ReadonlyArray<string> | null | undefined;
  allowElement: AllowElement | null | undefined;
  disallowedElements: ReadonlyArray<string> | null | undefined;
  skipHtml: boolean | null | undefined;
  unwrapDisallowed: boolean | null | undefined;
  urlTransform: UrlTransform;
}

export function buildTransform(ctx: TransformContext): BuildVisitor<Root> {
  return function transform(node, index, parent) {
    if (node.type === 'raw' && parent && typeof index === 'number') {
      if (ctx.skipHtml) {
        parent.children.splice(index, 1);
      } else {
        parent.children[index] = { type: 'text', value: (node as { value: string }).value };
      }
      return index;
    }

    if (node.type === 'element') {
      const element = node as Element;
      let key: string;
      // hast's `Element.properties` is typed `Properties | undefined`. In the
      // current pipeline every emitter sets it to at least `{}`, but a future
      // custom handler that omits `properties` would otherwise blow up in
      // `Object.hasOwn` here — keep the fallback so the transform stays robust
      // against new handler shapes.
      const properties = element.properties ?? {};

      for (key in urlAttributes) {
        if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(properties, key)) {
          const test = (urlAttributes as Record<string, ReadonlyArray<string> | null>)[key];
          if (test === null || test.includes(element.tagName)) {
            // Convergent application: always transform FROM the original —
            // the stash if an earlier pass archived one, else the live
            // property (untouched ⇔ nothing was archived). A shared
            // (memoized) tree that is re-entered without a re-parse — a
            // block-memo cache miss after a G3 flush, a urlTransform prop
            // swap, the aggregate footnote tree on a registry bump — then
            // yields `currentTransform(original)` instead of compounding the
            // transform onto its own previous output. This is what lets
            // `renderHastSubtree` skip the defensive clone for URL rewriting.
            //
            // The stash is written only by the first pass that actually
            // CHANGES the value: the default transform is identity for safe
            // URLs, and these elements live long in the block-memo cache and
            // the registry's footnote trees — an unconditional per-element
            // stash would be retained dead weight on every URL-bearing node.
            const stash = (element.data as { originalUrls?: Record<string, unknown> } | undefined)?.originalUrls;
            const hasStash = stash !== undefined && key in stash;
            const original = hasStash ? stash[key] : properties[key];
            const transformed = ctx.urlTransform(String(original || ''), key, element);
            if (!hasStash && transformed !== original) {
              const data = (element.data ??= {}) as { originalUrls?: Record<string, unknown> };
              (data.originalUrls ??= {})[key] = original;
            }
            properties[key] = transformed;
          }
        }
      }
      element.properties = properties;
    }

    if (node.type === 'element') {
      const element = node as Element;
      let remove = ctx.allowedElements
        ? !ctx.allowedElements.includes(element.tagName)
        : ctx.disallowedElements
          ? ctx.disallowedElements.includes(element.tagName)
          : false;

      if (!remove && ctx.allowElement && typeof index === 'number') {
        remove = !ctx.allowElement(element, index, parent);
      }

      if (remove && parent && typeof index === 'number') {
        if (ctx.unwrapDisallowed && element.children) {
          parent.children.splice(index, 1, ...element.children);
        } else {
          parent.children.splice(index, 1);
        }
        return index;
      }
    }

    return undefined;
  };
}
