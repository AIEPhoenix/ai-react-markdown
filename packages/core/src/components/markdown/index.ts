/**
 * Internal barrel for the local Markdown wrapper. Not re-exported from the
 * core package's public entrypoint — callers should keep going through
 * `<AIMarkdown>`.
 *
 * @module components/markdown
 */

export { default, Markdown, parseStage, transformStage, renderHastSubtree } from './Markdown';
export type { ParsedMarkdown } from './Markdown';
export { defaultUrlTransform } from '@ai-react-markdown/engine';
export type { AllowElement, Components, Deprecation, ExtraProps, Options, UrlTransform } from './types';
