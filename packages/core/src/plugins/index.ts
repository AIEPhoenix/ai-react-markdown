/**
 * `@ai-react-markdown/core/plugins` — the sealed engine plugin catalog.
 *
 * ```ts
 * import { highlight, definitionList, pangu,
 *          defaultEnginePlugins } from '@ai-react-markdown/core/plugins';
 *
 * <AIMarkdown enginePlugins={[highlight, definitionList, pangu]} />
 * // absent  → defaultEnginePlugins (all five)
 * // present → wholesale replacement (array-atomic semantics)
 * ```
 *
 * @module @ai-react-markdown/core/plugins
 */

export { highlight, definitionList, smartypants, pangu, removeComments, defaultEnginePlugins } from './catalog';
export type { AIMarkdownEnginePlugin, AIMarkdownEnginePluginName } from './defs';
