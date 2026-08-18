/**
 * Direction B: source-level phantom-definition injection helpers.
 *
 * @module components/remarkInjectPhantomDefs
 */

import { computeFreezeBoundary } from './incrementalParse/computeFreezeBoundary';

export const SENTINEL_LINK_URL = '__aimd_sentinel_link__';
export const SENTINEL_FN_CONTENT = '__aimd_sentinel_fn__';

export interface PhantomLabels {
  missingFootnotes: Set<string>;
  missingLinks: Set<string>;
}

/**
 * The phantom-definition SUFFIX for labels not locally defined ('' when
 * there are none). Kept separate from the join so the incremental engine
 * can treat it as always-tail: the suffix may shrink/grow/reorder between
 * frames (registry label churn) without breaking the append gate.
 *
 * Labels are expected to already be normalized via normalizeId (uppercase).
 */
export function buildPhantomSuffix(phantoms: PhantomLabels): string {
  if (phantoms.missingFootnotes.size === 0 && phantoms.missingLinks.size === 0) {
    return '';
  }
  let suffix = '\n\n';
  for (const label of phantoms.missingLinks) {
    suffix += `[${label}]: ${SENTINEL_LINK_URL}\n`;
  }
  for (const label of phantoms.missingFootnotes) {
    suffix += `[^${label}]: ${SENTINEL_FN_CONTENT}\n`;
  }
  return suffix;
}

/**
 * The bytes to put BETWEEN a chunk's content and its phantom suffix so the
 * suffix's definition lines are parsed as definitions.
 *
 * `buildPhantomSuffix` is appended (never prepended: the incremental engine
 * treats the suffix as an always-tail input, and prepending would shift
 * every source position). But an append lands INSIDE whatever block the
 * content ends in — and a fenced code block or `$$` flow-math block that is
 * still open at the end of a streaming frame swallows everything up to EOF:
 * the sentinel lines render as code/math text and, since no definition was
 * registered, every cross-chunk reference in the chunk falls back to literal
 * `[text][label]` for the whole time the block streams (2026-08 project
 * review, core-render-01). Closing the block first is output-neutral: an
 * unclosed fence/math block already renders exactly the lines it has, so
 * `content + closer` yields the same code/math node value (positions
 * extend past `content.length`, which every consumer already tolerates for
 * the suffix's own nodes).
 *
 * A closer is emitted ONLY for a block whose opener line sits at column 0:
 * that is provably a top-level fence, which only a top-level closer (same
 * char, ≥ length, ≤3 spaces indent) can end — exactly what the line scanner
 * tracks. Openers with any indent are left alone: the line model cannot
 * see container boundaries, and an indented opener may live in a list item
 * that later de-indented content already ended (micromark closed the fence
 * with the item; an emitted closer would OPEN a new fence around the
 * sentinel lines — v2.4.0 review R1) or be closed by a ≥4-space closer the
 * `^ {0,3}` scan does not recognize. Those shapes keep the plain append
 * (swallowed at worst — the pre-2.4.0 behaviour), never a wrong closer.
 *
 * Only fences and flow math are closed. Raw-HTML constructs (`<!--`, `<?`,
 * `<![CDATA[`, `<!X`, `<script>`) that stay open to EOF also swallow the
 * suffix (invisibly — sanitize strips them), but their closers are not
 * position-neutral for the paragraph-inline forms and the shapes are rare
 * in LLM output; they keep the plain-append behaviour. When the scanner's
 * fence/math phase is untrusted (`phasePoisonedAt` — a suppressed open in a
 * container, see computeFreezeBoundary blocker 7) no closer is emitted
 * either: a wrong closer would OPEN a block around the suffix.
 *
 * Returns '' when nothing needs closing. Cost: one line scan of `content`
 * (regex per line; no reference tracking) — only paid by chunks that have a
 * non-empty phantom suffix.
 */
export function phantomSuffixCloser(content: string): string {
  if (content === '') return '';
  const endsWithNewline = content.endsWith('\n');
  // Confirm the trailing partial line: the suffix's own leading newline
  // will, so the state that matters is the one AFTER that line.
  const confirmed = endsWithNewline ? content : content + '\n';
  const { checkpoint } = computeFreezeBoundary(confirmed, { defListEnabled: false, referenceTaint: false });
  if (checkpoint.phasePoisonedAt !== Infinity) return '';
  // Only a column-0 opener is provably top-level (see the doc comment).
  if (checkpoint.openIndent !== 0) return '';
  const nl = endsWithNewline ? '' : '\n';
  if (checkpoint.inFence) return `${nl}${checkpoint.fenceChar.repeat(checkpoint.fenceLen)}`;
  if (checkpoint.inMath) return `${nl}${'$'.repeat(checkpoint.mathFenceLen)}`;
  return '';
}
