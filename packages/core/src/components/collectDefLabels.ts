/**
 * Lightweight def-only parse: runs a minimal unified pipeline
 * (remark-parse + remark-gfm) to extract identifiers of all
 * `footnoteDefinition` and `definition` nodes from a markdown source string.
 *
 * Used by PASS 0 of cross-chunk coordination to discover label sets without
 * triggering the full to-hast pipeline. Output is normalized via normalizeId
 * (uppercase, whitespace-collapsed) — same canonical form used everywhere in
 * the registry, phantomFootnoteLabels Set, and handler comparisons.
 *
 * @module components/collectDefLabels
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Root as MdastRoot } from 'mdast';
import { normalizeId } from './normalizeId';

export interface DefLabels {
  footnoteLabels: Set<string>;
  linkLabels: Set<string>;
}

// Build helper kept as its own function so the cached processor's type is
// inferred as the FULL chained Processor (remark-parse + remark-gfm), not
// the bare `unified()` Processor with `undefined` extension types.
//
// NOTE: PASS 0 deliberately pins remark-parse + remark-gfm and ignores the
// pipeline's user remarkPlugins. The append-aware scanner below encodes
// grammar facts about exactly this plugin set — "definitions never cross a
// blank line", "a definition's `[` sits at a line's content start". If
// this processor ever grows plugins whose def-like constructs violate
// those facts (directives, MDX, multi-line containers), the scanner's
// fast path must be revisited: its replay tests only lock today's grammar.
function buildProcessor() {
  return unified().use(remarkParse).use(remarkGfm);
}
let _processor: ReturnType<typeof buildProcessor> | null = null;
function processor(): ReturnType<typeof buildProcessor> {
  if (!_processor) _processor = buildProcessor();
  return _processor;
}

export function collectDefLabels(source: string): DefLabels {
  if (!source) {
    return { footnoteLabels: new Set(), linkLabels: new Set() };
  }
  const mdast = processor().parse(source) as MdastRoot;
  const footnoteLabels = new Set<string>();
  const linkLabels = new Set<string>();
  visit(mdast, (node) => {
    if (node.type === 'footnoteDefinition' && 'identifier' in node) {
      footnoteLabels.add(normalizeId(node.identifier as string));
    } else if (node.type === 'definition' && 'identifier' in node) {
      linkLabels.add(normalizeId(node.identifier as string));
    }
  });
  return { footnoteLabels, linkLabels };
}

const setsEqual = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};

/** Blank line (whitespace-only), the boundary no definition can span.
 *  CRLF-aware on both newlines — without `\r?` a CRLF document never
 *  matches, the region silently becomes the whole source, and the fast
 *  path is vacuously off for that entire input class. */
const BLANK_LINE_RE = /\r?\n[ \t]*\r?\n/g;

/** Index just past the LAST blank line of `source`, or 0 if none.
 *  Plain non-overlapping scan: for runs of blanks ("\n\n\n") this can land
 *  a newline or two early, but the slack is whitespace-only and whitespace
 *  can never satisfy DEF_LINE_START_RE, so the decision is identical.
 *  @internal exported for tests only — the fast path is otherwise
 *  indistinguishable from a full parse whose sets came out equal. */
export function lastRegionStart(source: string): number {
  BLANK_LINE_RE.lastIndex = 0;
  let start = 0;
  for (let m = BLANK_LINE_RE.exec(source); m !== null; m = BLANK_LINE_RE.exec(source)) {
    start = m.index + m[0].length;
  }
  return start;
}

/** A line that can START a definition: `[` preceded only by whitespace and
 *  container prefixes (blockquote `>`, list bullets, ordered-list digits).
 *  A definition's `[` always sits at its line's content start, so mid-line
 *  brackets — inline links `[t](u)`, citations `[1]`, exactly what AI prose
 *  is dense with — must NOT knock the stream off the fast path. The `m`
 *  flag also matches at index 0, which is a true line start (the region
 *  begins just past a blank line or at the document start). Over-matching
 *  (a bulleted link `- [t](u)`) is safe: it costs a redundant full parse,
 *  never a wrong result.
 *  @internal exported for tests only. */
export const DEF_LINE_START_RE = /^[ \t>*+\d.)-]*\[/m;

export interface DefLabelScanner {
  /** Equivalent to `collectDefLabels(source)` at every call, but cheap for
   *  the streaming common case. Returns a REFERENCE-STABLE result while the
   *  label set is unchanged. */
  scan(source: string): DefLabels;
}

/**
 * Append-aware wrapper around {@link collectDefLabels} for the streaming
 * hot path: PASS 0 re-runs on every token, but its result — the def label
 * set — almost never changes while prose streams in.
 *
 * Fast path: when the new source merely APPENDS to the previous one, the
 * label set can only differ if the affected region contains a line whose
 * content starts with `[` (see DEF_LINE_START_RE — a definition's bracket
 * is always line-anchored, so mid-line brackets from inline links and
 * citations stay on the fast path). That region is the previous source's
 * text SINCE ITS LAST BLANK LINE plus the appended text — not just the
 * appended text, because CommonMark definitions span lines (`[x]:` with
 * the destination on the next line) and a trailing append can re-type an
 * entire paragraph (setext `===`). No construct that produces or destroys
 * a definition crosses a blank line (labels, destinations and titles all
 * forbid them), so text before that boundary is settled. When the region
 * has no def-capable line, the previous result is returned AS-IS;
 * otherwise (and for any non-append change) a full re-parse runs, and the
 * previous result object is kept whenever the recomputed sets are equal.
 *
 * Misjudging conservatively (an unnecessary `[` hit — e.g. inside an open
 * code fence) only costs a redundant full parse, never a wrong result.
 *
 * The reference stability doubles as churn control: consumers that list
 * the result in effect deps (chunk re-registration) stop firing per token.
 */
export function createDefLabelScanner(): DefLabelScanner {
  let prevSource: string | null = null;
  let prevLabels: DefLabels | null = null;

  return {
    scan(source: string): DefLabels {
      if (prevSource !== null && prevLabels !== null) {
        if (source === prevSource) return prevLabels;
        if (source.startsWith(prevSource)) {
          const regionStart = lastRegionStart(prevSource);
          // Joined so a def line straddling the append boundary keeps its
          // line-start context.
          const region = prevSource.slice(regionStart) + source.slice(prevSource.length);
          if (!DEF_LINE_START_RE.test(region)) {
            prevSource = source;
            return prevLabels;
          }
        }
      }
      const next = collectDefLabels(source);
      if (
        prevLabels !== null &&
        setsEqual(next.footnoteLabels, prevLabels.footnoteLabels) &&
        setsEqual(next.linkLabels, prevLabels.linkLabels)
      ) {
        prevSource = source;
        return prevLabels;
      }
      prevSource = source;
      prevLabels = next;
      return next;
    },
  };
}
