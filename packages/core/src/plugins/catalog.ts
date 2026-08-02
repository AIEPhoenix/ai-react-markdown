/**
 * The five shipped engine plugins and the default set.
 *
 * Construction happens ONLY here (principle P7: capability construction
 * follows the verification harness — the certification rig lives in this
 * package). Each object is frozen and carries internal stage metadata that
 * fixes its position in the produced chain; see `plugins/defs.ts` for the
 * seal rationale.
 *
 * @module plugins/catalog
 */

import type { AIMarkdownEnginePlugin, AIMarkdownEnginePluginName, EnginePluginInternals } from './defs';

const seal = (name: AIMarkdownEnginePluginName, stage: EnginePluginInternals['stage']): AIMarkdownEnginePlugin =>
  Object.freeze({
    name,
    '~sealed': 'ai-react-markdown/engine-plugin',
    stage,
  }) as AIMarkdownEnginePlugin;

/** `==Highlight==` syntax support (v1.x: `AIMarkdownRenderExtraSyntax.HIGHLIGHT`). */
export const highlight = seal('highlight', 'extraSyntax');

/**
 * Definition list syntax (v1.x: `AIMarkdownRenderExtraSyntax.DEFINITION_LIST`).
 * @see https://michelf.ca/projects/php-markdown/extra/#def-list
 */
export const definitionList = seal('definitionList', 'extraSyntax');

/** Strip HTML comments from the content (v1.x: `REMOVE_COMMENTS`). */
export const removeComments = seal('removeComments', 'displayOptimize');

/**
 * Typographic enhancements via SmartyPants — curly quotes, em-dashes, etc.
 * (v1.x: `SMARTYPANTS`). @see https://www.npmjs.com/package/smartypants
 */
export const smartypants = seal('smartypants', 'displayOptimize');

/** Automatic spacing between CJK and half-width characters (v1.x: `PANGU`). */
export const pangu = seal('pangu', 'displayOptimize');

/**
 * The default engine plugin set — all five, in canonical chain order.
 * Parity with the v1.x shipped defaults (`defaultAIMarkdownRenderConfig`).
 *
 * The recommended "turn one off" idiom:
 * ```ts
 * <AIMarkdown enginePlugins={defaultEnginePlugins.filter((p) => p !== pangu)} />
 * ```
 */
export const defaultEnginePlugins: readonly AIMarkdownEnginePlugin[] = Object.freeze([
  highlight,
  definitionList,
  removeComments,
  smartypants,
  pangu,
]);
