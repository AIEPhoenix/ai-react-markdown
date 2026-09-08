/** Framework-independent algorithm contracts for ai-markdown adapters.
 * Beta APIs may evolve before stable 3.0.0. Test fixtures and implementation
 * registry storage are intentionally source-only, outside this root entry.
 */

// ── M3: incremental-parse engine + definition machinery ──────────────────
export * from './components/incrementalParse';
export { codePointSnapshots } from './components/incrementalParse/codePointSnapshots';
export {
  collectDefLabels,
  createDefLabelScanner,
  type DefLabels,
  type DefLabelScanner,
} from './components/collectDefLabels';
export * from './components/extractDefBodiesFromHast';
export * from './components/extractContributions';
export { createRegistry } from './registry';
export type { Registry, RegistryController, ChunkData, FootnoteDef, LinkDef, RefKind, RefRecord } from './registry';

// ── M2: pipeline assembly ────────────────────────────────────────────────
export * from './components/markdown';
export * from './components/pluginChain';
export {
  rehypeVerifyEngineTags,
  ENGINE_PLACEHOLDER_TAGS,
  ENGINE_PROVENANCE_PROPERTY,
  type RehypeVerifyEngineTagsOptions,
} from './components/rehypeVerifyEngineTags';
export {
  default as rehypeRebaseHashLinks,
  type RehypeRebaseHashLinksOptions,
} from './components/rehypeRebaseHashLinks';
export { default as rehypeFooterAdorn } from './components/rehypeFooterAdorn';
export * from './components/remarkInjectPhantomDefs';
export * from './components/customMdastHandlers';
export * from './components/crossChunkUrlSanitize';
export * from './components/resolveCrossChunkReference';
export * from './plugins/defs';
export * from './plugins/catalog';

// ── M1: zero-dependency leaves ───────────────────────────────────────────
// Named (not star): isWhitespaceText is internal-only (2.8.1 surface trim).
export { isFootnoteSection, lastMeaningfulIdx } from './components/hastPredicates';
export * from './components/normalizeId';
export * from './components/shortenDocumentId';
export * from './components/devStageTimings';
// Named (not star): mergeClassNameAllowlist is internal-only (2.8.1 surface
// trim) — consumers extend via extendSanitizeSchema below.
export { sanitizeSchema } from './components/sanitizeSchema';
export * from './components/extendSanitizeSchema';
export * from './components/smoothStream/controller';
export * from './preprocessors/defs';
export { default as preprocessAIMDContent } from './preprocessors';
// Named (not star): splitByProtectedRegions is an internal segmentation
// helper (2.8.1 surface trim).
export { preprocessLaTeX, createIncrementalLatexPreprocessor } from './preprocessors/latex';
export * from './preprocessors/remend';
