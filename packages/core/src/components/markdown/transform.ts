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

      for (key in urlAttributes) {
        if (
          Object.hasOwn(urlAttributes, key) &&
          Object.hasOwn(element.properties, key)
        ) {
          const value = element.properties[key];
          const test = (urlAttributes as Record<string, ReadonlyArray<string> | null>)[key];
          if (test === null || test.includes(element.tagName)) {
            element.properties[key] = ctx.urlTransform(String(value || ''), key, element);
          }
        }
      }
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
