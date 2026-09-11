/** Assemble document footnotes as HAST without framework nodes or DOM access. */
import type { Element as HastElement, ElementContent as HastElementContent } from 'hast';
import { footnoteSafeId, lastMeaningfulIdx, type Registry } from '@ai-markdown/engine';
import { cloneHastForRender } from './cloneHastForRender';

interface OrderedDef {
  /** Uppercase-normalized label, used to query `registry.getRefsForLabel`. */
  normalizedLabel: string;
  /** mdast's case-folded identifier — used in HTML ids so the aggregate
   *  footer's `<li id>` matches the inline sup's anchor href exactly. */
  sourceIdentifier: string;
  bodyHast: HastElementContent[];
  n: number | null;
  withBackref: boolean;
}

/**
 * Build a backref anchor for a specific occurrence of a footnote ref.
 * Matches mdast-util-to-hast's default `defaultFootnoteBackContent`:
 *  - Anchor content is always the text `↩`.
 *  - When occurrence > 1, a child `<sup>${N}</sup>` is appended so the
 *    digit renders as a superscript (visually `↩²`, `↩³`, …) instead of
 *    a flat string like `↩2`.
 *  - The 1st occurrence href is bare `#fnref-${id}`; the N-th (N > 1)
 *    href is `#fnref-${id}-${N}` to match `FootnoteSupNumber`'s
 *    suffix-disambiguated id on the inline sup side.
 */
function buildBackref(href: string, occurrence: number, globalNumber: number): HastElement {
  const children: HastElement['children'] = [{ type: 'text', value: '↩' }];
  if (occurrence > 1) {
    children.push({
      type: 'element',
      tagName: 'sup',
      properties: {},
      children: [{ type: 'text', value: String(occurrence) }],
    });
  }
  const ariaLabel =
    occurrence === 1 ? `Back to reference ${globalNumber}` : `Back to reference ${globalNumber}-${occurrence}`;
  return {
    type: 'element',
    tagName: 'a',
    properties: {
      href,
      dataFootnoteBackref: '',
      className: ['data-footnote-backref'],
      ariaLabel,
    },
    children,
  };
}

export function buildAggregateTree(
  registry: Registry,
  clobberPrefix: string,
  preserveOrphanReferences = false
): HastElement | null {
  // Walk chunkOrder; collect every FOOTNOTE label that is referenced
  // somewhere — in flow text, or inside another footnote's body (a nested
  // ref, `nestedIn` set) — and order the entries by `registry.globalNumber`,
  // the same selector the inline `<sup>` marks read. The registry numbers
  // nested-only footnotes after every flow reference, in the order the
  // bodies render, which is where a standalone footer lists them; walking
  // refs in source order alone would put such a footnote at the position of
  // the body that mentions it. Link/image refs share the `refs` array but
  // belong to a disjoint namespace — they must be skipped here, otherwise a
  // link-ref to a label sharing text with a footnote-def would cause a
  // duplicate `<li>` in the aggregate footer.
  const seen = new Set<string>();
  const ordered: OrderedDef[] = [];
  for (const sym of registry.chunkOrder) {
    const data = registry.chunkData.get(sym);
    if (!data) continue;
    for (const ref of data.refs) {
      if (ref.kind !== 'footnote') continue;
      if (seen.has(ref.label)) continue;
      seen.add(ref.label);
      const canonicalSym = registry.canonicalFootnoteFor(ref.label);
      if (!canonicalSym) continue;
      const def = registry.chunkData.get(canonicalSym)?.defs.get(ref.label);
      if (!def) continue;
      const n = registry.globalNumber(ref.label);
      if (n === null) continue;
      // Fall back to the uppercase-normalized label when sourceIdentifier is
      // absent (older fixtures); production data always carries the field.
      const sourceIdentifier = def.sourceIdentifier ?? ref.label;
      ordered.push({
        normalizedLabel: ref.label,
        sourceIdentifier,
        bodyHast: def.bodyHast ?? [],
        n,
        withBackref: true,
      });
    }
  }
  ordered.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));

  if (preserveOrphanReferences) {
    for (const sym of registry.chunkOrder) {
      const data = registry.chunkData.get(sym);
      if (!data) continue;
      for (const [label, def] of data.defs) {
        if (seen.has(label)) continue;
        if (registry.canonicalFootnoteFor(label) !== sym) continue;
        seen.add(label);
        ordered.push({
          normalizedLabel: label,
          sourceIdentifier: def.sourceIdentifier ?? label,
          bodyHast: def.bodyHast ?? [],
          n: null,
          withBackref: false,
        });
      }
    }
  }

  if (ordered.length === 0) return null;

  const liElements: HastElement[] = ordered.map(({ normalizedLabel, sourceIdentifier, bodyHast, n, withBackref }) => {
    // Same id encoding as mdast-util-to-hast's footer / the marks (percent-
    // encoded non-ASCII etc.); the body harvest keys by this same fragment
    // and the cursor anchor decodes it through `sourceIdFromFootnoteLiId`.
    const safeId = footnoteSafeId(sourceIdentifier);
    // Assembly-time clone: the backref logic below pushes anchors into these
    // children, which must never mutate the registry-held `bodyHast`.
    const liChildren = bodyHast.map((c) => cloneHastForRender(c));
    if (withBackref) {
      // Emit one backref anchor per global occurrence of this label. The
      // first href uses the bare `fnref-${id}` (matches FootnoteSupNumber's
      // unsuffixed first ref); the Nth (N > 1) uses `fnref-${id}-${N}`
      // (matches FootnoteSupNumber's `-N` suffix on subsequent refs).
      //
      // A single space text node precedes each anchor so adjacent backrefs
      // don't run together visually (and so the first backref doesn't butt
      // up against the def body's trailing text). This mirrors what
      // mdast-util-to-hast's default footer naturally produces: the trailing
      // newline in the def's source becomes a text " " between body and
      // backref, plus an explicit space separator between consecutive
      // backrefs (see mdast-util-to-hast `lib/footer.js`).
      const totalRefs = registry.getRefsForLabel(normalizedLabel);
      // Match mdast-util-to-hast's append rule: if the TAIL of the def
      // body (skipping wrap-emitted `\n`) is `<p>`, push backrefs into
      // it; otherwise push them at the end of the `<li>` directly. The
      // previous logic searched for the last `<p>` anywhere in the body,
      // which mis-placed the backref BEFORE a trailing `<pre>` /
      // `<blockquote>` / etc. for multi-block defs.
      const tailIdx = lastMeaningfulIdx(liChildren);
      const tail = tailIdx !== -1 ? liChildren[tailIdx] : null;
      const dest =
        tail && tail.type === 'element' && (tail as HastElement).tagName === 'p' ? (tail as HastElement) : null;
      const appended: HastElementContent[] = [];
      for (let i = 1; i <= Math.max(totalRefs, 1); i++) {
        appended.push({ type: 'text', value: ' ' });
        const href = i === 1 ? `#${clobberPrefix}fnref-${safeId}` : `#${clobberPrefix}fnref-${safeId}-${i}`;
        appended.push(buildBackref(href, i, n ?? 0));
      }
      if (dest) {
        dest.children = [...dest.children, ...appended];
      } else if (tailIdx !== -1) {
        // Splice after the meaningful tail so any subsequent trailing
        // whitespace (`\n` from state.wrap) survives at the end of the
        // <li>, matching mdast-util-to-hast's post-wrap shape:
        //   [..., <tail-block>, ...backrefs, "\n"]
        liChildren.splice(tailIdx + 1, 0, ...appended);
      } else {
        liChildren.push(...appended);
      }
    }
    return {
      type: 'element',
      tagName: 'li',
      properties: {
        id: `${clobberPrefix}fn-${safeId}`,
        // Stringified: @types/hast (≥3.0.5) types li's `value` as string;
        // React serializes value={3} and value="3" to identical markup.
        ...(n !== null ? { value: String(n) } : {}),
      },
      children: liChildren,
    };
  });

  return {
    type: 'element',
    tagName: 'section',
    properties: {
      className: ['footnotes'],
      dataFootnotes: true,
      // a11y: name the section landmark so screen readers still announce it
      // even though the visible "Footnotes" h2 is omitted in coordinated mode.
      ariaLabel: 'Footnotes',
    },
    children: [
      // Conventional separator above the footnote list. The default
      // mdast-util-to-hast footer doesn't emit one (GitHub renders the
      // separation via CSS `border-top` on `.footnotes`); we render a literal
      // `<hr>` so the visual break is preserved without sanitize-friendly CSS.
      {
        type: 'element',
        tagName: 'hr',
        properties: {},
        children: [],
      },
      {
        type: 'element',
        tagName: 'ol',
        properties: {},
        children: liElements,
      },
    ],
  };
}
