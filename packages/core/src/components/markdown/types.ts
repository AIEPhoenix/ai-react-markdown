/**
 * Public types for the local Markdown wrapper — the React half after
 * boundary action ③: the pipeline-facing fields live in the engine's
 * `PipelineOptions`, and {@link Options} extends it with the React-only
 * `components` field. Pure types are re-exported so this module's surface
 * is unchanged for existing importers.
 *
 * Ported 1:1 from react-markdown v10's lib/index.js JSDoc.
 *
 * @module components/markdown/types
 */

import type { Element } from 'hast';
import type { ComponentType, JSX } from 'react';
import type { PipelineOptions } from '@ai-react-markdown/engine';

export type { AllowElement, Deprecation, PipelineOptions, UrlTransform } from '@ai-react-markdown/engine';

/** Extra fields the wrapper passes to user-supplied tag components. */
export interface ExtraProps {
  node?: Element | undefined;
}

/** Map tag names to user components or other tag names. */
export type Components = {
  [Key in keyof JSX.IntrinsicElements]?:
    ComponentType<JSX.IntrinsicElements[Key] & ExtraProps> | keyof JSX.IntrinsicElements;
};

/** Configuration for the {@link Markdown} component. */
export interface Options extends PipelineOptions {
  components?: Components | null | undefined;
}
