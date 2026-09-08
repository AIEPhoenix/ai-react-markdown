/**
 * `@ai-markdown/react/plugins` — the sealed engine plugin catalog.
 *
 * ```ts
 * import { highlight, definitionList, pangu,
 *          defaultEnginePlugins } from '@ai-markdown/react/plugins';
 *
 * <AIMarkdown enginePlugins={[highlight, definitionList, pangu]} />
 * // absent  → defaultEnginePlugins (all five)
 * // present → wholesale replacement (array-atomic semantics)
 * ```
 *
 * @module @ai-markdown/react/plugins
 */

export {
  highlight,
  definitionList,
  smartypants,
  pangu,
  removeComments,
  defaultEnginePlugins,
} from '@ai-markdown/engine';
export type { AIMarkdownEnginePlugin, AIMarkdownEnginePluginName } from '@ai-markdown/engine';
