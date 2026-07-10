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

/** Blank line (whitespace-only), the boundary no definition can span. */
const BLANK_LINE_RE = /\n[ \t]*\n/g;

/** Index just past the LAST blank line of `source`, or 0 if none. */
function lastRegionStart(source: string): number {
  BLANK_LINE_RE.lastIndex = 0;
  let start = 0;
  for (let m = BLANK_LINE_RE.exec(source); m !== null; m = BLANK_LINE_RE.exec(source)) {
    start = m.index + m[0].length;
    // Overlapping blanks ("\n\n\n"): resume inside the match so the next
    // blank pair is still seen; regex lastIndex would skip past it.
    BLANK_LINE_RE.lastIndex = m.index + 1;
  }
  return start;
}

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
 * label set can only differ if the affected region contains a `[`. That
 * region is the previous source's text SINCE ITS LAST BLANK LINE plus the
 * appended text — not just the appended text, because CommonMark
 * definitions span lines (`[x]:` with the destination on the next line)
 * and a trailing append can re-type an entire paragraph (setext `===`).
 * No construct that produces or destroys a definition crosses a blank
 * line (labels, destinations and titles all forbid them), so text before
 * that boundary is settled. When the region has no `[`, the previous
 * result is returned AS-IS; otherwise (and for any non-append change) a
 * full re-parse runs, and the previous result object is kept whenever the
 * recomputed sets are equal.
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
          const appended = source.slice(prevSource.length);
          if (prevSource.indexOf('[', regionStart) === -1 && !appended.includes('[')) {
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
