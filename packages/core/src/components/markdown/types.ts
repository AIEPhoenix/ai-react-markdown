/**
 * Public types for the local Markdown wrapper. Ported 1:1 from react-markdown
 * v10's lib/index.js JSDoc, restructured as TypeScript declarations.
 *
 * @module components/markdown/types
 */

import type { Element, Parents } from 'hast';
import type { ComponentType, JSX } from 'react';
import type { Options as RemarkRehypeOptions } from 'remark-rehype';
import type { PluggableList } from 'unified';

/** Extra fields the wrapper passes to user-supplied tag components. */
export interface ExtraProps {
  node?: Element | undefined;
}

/** Map tag names to user components or other tag names. */
export type Components = {
  [Key in keyof JSX.IntrinsicElements]?:
    ComponentType<JSX.IntrinsicElements[Key] & ExtraProps> | keyof JSX.IntrinsicElements;
};

/** Filter callback for elements. Return falsy to drop. */
export type AllowElement = (
  element: Readonly<Element>,
  index: number,
  parent: Readonly<Parents> | undefined
) => boolean | null | undefined;

/** Transform every URL on every element attribute. Return null/empty to strip. */
export type UrlTransform = (url: string, key: string, node: Readonly<Element>) => string | null | undefined;

/** Configuration for the {@link Markdown} component. */
export interface Options {
  allowElement?: AllowElement | null | undefined;
  allowedElements?: ReadonlyArray<string> | null | undefined;
  children?: string | null | undefined;
  components?: Components | null | undefined;
  disallowedElements?: ReadonlyArray<string> | null | undefined;
  rehypePlugins?: PluggableList | null | undefined;
  remarkPlugins?: PluggableList | null | undefined;
  remarkRehypeOptions?: Readonly<RemarkRehypeOptions> | null | undefined;
  skipHtml?: boolean | null | undefined;
  unwrapDisallowed?: boolean | null | undefined;
  urlTransform?: UrlTransform | null | undefined;
}

/** Internal: deprecated prop entry. */
export interface Deprecation {
  from: string;
  id: string;
  to?: keyof Options;
}
