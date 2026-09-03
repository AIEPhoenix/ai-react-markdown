/**
 * @ai-react-markdown/engine — framework-agnostic Markdown engine.
 *
 * Entry barrel (boundary action ⑤): pure re-exports only. Populated batch
 * by batch as modules migrate in from core (M1–M3); no runtime logic may
 * ever live in this file.
 *
 * Contract: this package is the internal supplier for
 * `@ai-react-markdown/core`. Its export surface tracks what core (and
 * core's stories/tests) consume — no public API stability is promised
 * before 3.0.0.
 */

// ── Fixtures (boundary action ⑦) ─────────────────────────────────────────
export * from './fixtures/scenarios';

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
export * from './components/documentRegistry';

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
