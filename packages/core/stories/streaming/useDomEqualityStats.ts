'use client';

/**
 * Shared per-frame DOM-equality accumulator for the flag-on/flag-off
 * comparison surfaces (smoke story, verification playground, same-page
 * comparison). Three hand-rolled copies of this checker had already
 * drifted (scan-count filters, clobber normalization) — review finding R3.
 *
 * The hook only ACCUMULATES (into a ref, post-commit); each caller decides
 * its own mirroring-to-state policy (final-only, throttled, idle-only).
 * `normalize` must be referentially stable (module fn or useCallback) and
 * is where clobber-prefix normalization plugs in when the two sides use
 * different documentIds.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { shortenDocumentId } from '@ai-react-markdown/engine';

export interface DomEqualityStats {
  frames: number;
  mismatches: number;
  firstMismatchLength: number;
}

/**
 * THE clobber-prefix normalizer for dual-instance comparisons (final-review
 * R4 — three independent copies of this derivation had appeared).
 *
 * Comparison sides intentionally use DIFFERENT documentIds (that is what
 * scopes the per-side stage channel), and documentId feeds the clobber
 * prefix that rehype-sanitize/rehypeRebaseHashLinks stamp onto footnote ids
 * and hash hrefs — so the raw innerHTML of the two sides differs BY
 * CONFIGURATION the moment a footnote renders, not by any splice defect.
 * Built with the SAME derivation as src/context.tsx (shortenDocumentId +
 * encodeURIComponent), so renaming docIds — even past the 16-char hashing
 * threshold — can never silently desynchronize the replace.
 */
export function normalizeClobberPrefix(html: string, docId: string): string {
  return html.replaceAll(`${encodeURIComponent(shortenDocumentId(docId))}-user-content-`, '§doc§-user-content-');
}

const fresh = (): DomEqualityStats => ({ frames: 0, mismatches: 0, firstMismatchLength: -1 });

export function useDomEqualityStats(
  onRef: RefObject<HTMLDivElement | null>,
  offRef: RefObject<HTMLDivElement | null>,
  content: string,
  normalize?: (html: string, side: 'on' | 'off') => string
): { statsRef: RefObject<DomEqualityStats>; reset: () => void } {
  const statsRef = useRef<DomEqualityStats>(fresh());

  // Post-commit: both sides have rendered THIS content — compare live DOM.
  useEffect(() => {
    if (!content || !onRef.current || !offRef.current) return;
    const stats = statsRef.current;
    stats.frames += 1;
    const on = normalize ? normalize(onRef.current.innerHTML, 'on') : onRef.current.innerHTML;
    const off = normalize ? normalize(offRef.current.innerHTML, 'off') : offRef.current.innerHTML;
    if (on !== off) {
      stats.mismatches += 1;
      if (stats.firstMismatchLength === -1) stats.firstMismatchLength = content.length;
    }
  }, [content, normalize, onRef, offRef]);

  const reset = useCallback(() => {
    statsRef.current = fresh();
  }, []);

  return { statsRef, reset };
}
