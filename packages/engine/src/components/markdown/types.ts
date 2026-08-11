/**
 * Pipeline-facing types for the Markdown processing stages. The pure half of
 * core's `components/markdown/types.ts`, split out in boundary action ③:
 * every field here is consumed by the framework-agnostic pipeline
 * (processor/transform/stages); the React-only `components` field stays in
 * core, whose `Options` extends {@link PipelineOptions} with it.
 *
 * Ported 1:1 from react-markdown v10's lib/index.js JSDoc.
 *
 * @module components/markdown/types
 */

import type { Element, Parents } from 'hast';
import type { Options as RemarkRehypeOptions } from 'remark-rehype';
import type { PluggableList } from 'unified';

/** Filter callback for elements. Return falsy to drop. */
export type AllowElement = (
  element: Readonly<Element>,
  index: number,
  parent: Readonly<Parents> | undefined
) => boolean | null | undefined;

/** Transform every URL on every element attribute. Return null/empty to strip. */
export type UrlTransform = (url: string, key: string, node: Readonly<Element>) => string | null | undefined;

/** Configuration consumed by the pipeline stages (parse/transform). */
export interface PipelineOptions {
  allowElement?: AllowElement | null | undefined;
  allowedElements?: ReadonlyArray<string> | null | undefined;
  children?: string | null | undefined;
  disallowedElements?: ReadonlyArray<string> | null | undefined;
  rehypePlugins?: PluggableList | null | undefined;
  remarkPlugins?: PluggableList | null | undefined;
  remarkRehypeOptions?: Readonly<RemarkRehypeOptions> | null | undefined;
  skipHtml?: boolean | null | undefined;
  unwrapDisallowed?: boolean | null | undefined;
  urlTransform?: UrlTransform | null | undefined;
}

/**
 * Internal: deprecated prop entry. `to` was `keyof Options` before the ③
 * bisection; `'components'` is the one Options key that lives React-side,
 * kept in the union so the deprecation table stays byte-identical.
 */
export interface Deprecation {
  from: string;
  id: string;
  to?: keyof PipelineOptions | 'components';
}
