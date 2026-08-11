/**
 * Internal barrel for the local Markdown wrapper. Not re-exported from the
 * core package's public entrypoint — callers should keep going through
 * `<AIMarkdown>`.
 *
 * @module components/markdown
 */

export { default, Markdown, renderHastSubtree } from './Markdown';
export { parseStage, transformStage, type ParsedMarkdown } from '@ai-react-markdown/engine';
export { defaultUrlTransform } from '@ai-react-markdown/engine';
export type { AllowElement, Components, Deprecation, ExtraProps, Options, UrlTransform } from './types';
