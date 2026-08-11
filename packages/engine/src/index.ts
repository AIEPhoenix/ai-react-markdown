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

// ── M2: pipeline assembly ────────────────────────────────────────────────
export * from './components/markdown';

// ── M1: zero-dependency leaves ───────────────────────────────────────────
export * from './components/hastPredicates';
export * from './components/normalizeId';
export * from './components/shortenDocumentId';
export * from './components/devStageTimings';
export * from './components/sanitizeSchema';
export * from './components/extendSanitizeSchema';
export * from './components/smoothStream/controller';
export * from './preprocessors/defs';
export { default as preprocessAIMDContent } from './preprocessors';
export * from './preprocessors/latex';
export * from './preprocessors/remend';
