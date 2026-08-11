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

export {};
