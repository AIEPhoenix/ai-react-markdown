/**
 * Engine-side barrel for the Markdown pipeline machinery — the pure half of
 * core's `components/markdown` (boundary action ②). The React half
 * (`Markdown`, `renderHastSubtree`, `Components`) stays in core, whose own
 * barrel re-exports these symbols so its import surface is unchanged.
 *
 * @module components/markdown
 */

export { createFile, createProcessor } from './processor';
export { buildTransform, type TransformContext } from './transform';
export { defaultUrlTransform } from './urlTransform';
export type { AllowElement, Deprecation, PipelineOptions, UrlTransform } from './types';
