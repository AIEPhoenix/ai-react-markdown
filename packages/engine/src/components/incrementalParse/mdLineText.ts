/**
 * Markdown line-text primitives shared by the freeze scanner and the
 * reference-taint module (extracted in two-model plan P2 — a pure move).
 *
 * Markdown whitespace is U+0020 / U+0009 (plus line endings) — NOT the
 * Unicode set JS `trim()` strips. A line holding only U+3000 / U+00A0 is
 * paragraph text (a lazy continuation line) for micromark, and a fence
 * closer followed by NBSP is not a closer. Using `trim()` here made the
 * scanner emit a candidate inside an unfinished paragraph (v2.4.1 review
 * P1 — CJK output does carry full-width-space-only lines).
 */

export const MD_BLANK_RE = /^[ \t\r]*$/;
export const isMdBlank = (text: string): boolean => MD_BLANK_RE.test(text);
/** ASCII-only counterparts of `trim()` / `trimStart()` — every scanner verdict
 *  must strip exactly what micromark strips (adversarial review
 *  of the first fix: a def rest ending in NBSP registered a ghost def; a
 *  U+3000 before a paragraph-inline `<!--` skipped the divergence poison). */
export const mdTrim = (text: string): string => text.replace(/^[ \t\r]+|[ \t\r]+$/g, '');
export const mdTrimStart = (text: string): string => text.replace(/^[ \t\r]+/, '');
