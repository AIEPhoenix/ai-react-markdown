/**
 * Extract footnote-definition bodies from a chunk's POST-pipeline hast tree.
 *
 * Why not just `toHast(def.children)` in extractContributions? That call runs
 * only mdast-util-to-hast's default handlers — no rehype-katex, no rehype-raw,
 * no rehype-footer-adorn, no clobber-prefix application. Defs containing math
 * (`$x$`), inline raw HTML, or definition-list extensions would render
 * incorrectly inside the cross-chunk aggregate footer.
 *
 * Instead, we read the FINAL hast: mdast-util-to-hast's `state.footer()` has
 * already emitted `<section data-footnotes><ol><li id="...fn-X">body</li>…`
 * for every def that has a real entry in `state.footnoteOrder`, the full
 * rehype chain has run on top, and the per-`<li>` body is exactly what the
 * standalone path would render. Lift those `<li>` children (minus the
 * auto-emitted backref `<a>`s, which the aggregate emits itself per
 * occurrence) and key by normalized label.
 *
 * Chunks whose only refs are phantom-injected (cross-chunk) won't have a
 * synthetic `<section>` at all — those chunks contribute no defs, and the
 * canonical-chunk handler upstream guarantees the def's body is captured
 * from the chunk that owns it.
 *
 * @module components/extractDefBodiesFromHast
 */
import { SKIP, visit } from 'unist-util-visit';
import type { Element as HastElement, Root as HastRoot, ElementContent } from 'hast';
import { normalizeId } from '@ai-react-markdown/engine';

// Fallback for callers that do not know the exact clobberPrefix. The main
// renderer passes the prefix explicitly so labels containing regex metacharacters
// or prefixes containing `user-content-fn-` are handled by string slicing.
const FN_LI_ID_RE = /(?:^|-)user-content-fn-(.+)$/;

/**
 * Extract the SOURCE identifier from a footnote `<li>` id, covering both id
 * shapes in the codebase — standalone (mdast-util-to-hast `fn-` +
 * `normalizeUri`, then the sanitize clobber + rehypeRebaseHashLinks linkage)
 * and aggregate (`${clobberPrefix}fn-${sourceIdentifier}`, raw). Exported as
 * the single source of truth for li-id parsing: the streaming cursor's
 * anchor targeting (`detectAnchor`) reuses it so a clobber-linkage change
 * can never drift the two consumers apart.
 */
export function sourceIdFromFootnoteLiId(idProp: string, clobberPrefix?: string): string | null {
  let raw: string | null = null;
  if (clobberPrefix !== undefined) {
    const exactPrefix = `${clobberPrefix}fn-`;
    if (idProp.startsWith(exactPrefix)) raw = idProp.slice(exactPrefix.length);
  }
  if (raw === null) {
    const m = idProp.match(FN_LI_ID_RE);
    raw = m ? m[1] : null;
  }
  if (raw === null) return null;
  // mdast-util-to-hast's footer emits `<li id="${prefix}fn-${normalizeUri(id)}">`
  // which percent-encodes whitespace, non-ASCII characters (`中文` → `%E4%B8%AD…`),
  // and most URL-unsafe punctuation. The registry's def key (set by
  // extractContributions via `normalizeId(node.identifier)`) is the DECODED
  // form — uppercase + whitespace-collapsed but otherwise the source bytes.
  // Without decoding here, every label that triggers normalizeUri encoding
  // (CJK, accented Latin, spaces, `&`/`?` punctuation) would key-mismatch
  // between harvested body and registry def, leaving the aggregate footer's
  // `<li>` empty for those labels.
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding (extremely rare — would require user-
    // supplied raw HTML in the def's id). Fall back to the raw form rather
    // than crashing the harvest. The raw form will key-mismatch the registry
    // def, so the aggregate footer's `<li>` renders empty for this label —
    // surface that in development instead of failing silently.
    // Bare env access on purpose — the dual dev/prod build resolves it at
    // build time, so dist never evaluates it. The previous `typeof process`
    // guard was dead in bundler browser dev (Vite substitutes only the bare
    // text, `typeof process` stays 'undefined'); do not reintroduce it.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[ai-react-markdown] Malformed percent-encoding in footnote id "${raw}"; ` +
          'its body may be missing from the aggregated footnote footer.'
      );
    }
    return raw;
  }
}

function isBackrefAnchor(c: ElementContent): boolean {
  if (c.type !== 'element') return false;
  const el = c as HastElement;
  if (el.tagName !== 'a') return false;
  return Boolean(el.properties && 'dataFootnoteBackref' in el.properties);
}

function isWhitespaceText(c: ElementContent): boolean {
  if (c.type !== 'text') return false;
  return /^\s*$/.test((c as { value: string }).value);
}

/** Index of the last child that isn't a whitespace-only text node, or -1
 *  if no such child exists. mdast-util-to-hast's `state.wrap(content, true)`
 *  inserts `\n` text nodes between (and around) block-level children of
 *  `<li>`; we have to look past those to find the meaningful tail before
 *  deciding which backref-strip case applies. */
function lastMeaningfulIdx(children: ElementContent[]): number {
  for (let i = children.length - 1; i >= 0; i--) {
    if (!isWhitespaceText(children[i])) return i;
  }
  return -1;
}

/**
 * Drop trailing auto-emitted backref anchors and any separator whitespace
 * mdast-util-to-hast emitted before them. Operates only on the tail of
 * `children` — does NOT recurse into mid-list elements — so user content
 * elsewhere in the def that happens to look like a backref anchor survives.
 *
 * The shapes we have to undo (see `mdast-util-to-hast/lib/footer.js`):
 *
 *   - **trailing wrap whitespace**: `state.wrap(content, true)` inserts
 *     `\n` text nodes between/around block-level children of `<li>`. The
 *     auto-emitted backref sits BEFORE the trailing `\n`, so we have to
 *     peel past whitespace before checking for the backref. Confirmed by
 *     a real-pipeline trace: an empty def produces
 *     `<li>` children = `["\n", <a backref>, "\n"]`.
 *   - **standalone separator** between consecutive backrefs (and before
 *     the first one when the trailing child is NOT a text node): a `{type:
 *     'text', value: ' '}` element pushed alongside the backref anchor.
 *   - **merged separator** before the first backref when the trailing
 *     child IS a text node: footer.js does `tailTail.value += ' '`, so the
 *     leading space is concatenated INTO the existing text node rather
 *     than pushed as a separate node. After peeling the backrefs, that
 *     residual trailing space sits at the end of the last text node and
 *     would visibly double when the aggregate footer prepends its own
 *     separator. Trim exactly one trailing space to undo it.
 */
function dropTrailingBackrefs(children: ElementContent[]): ElementContent[] {
  // Step 1: identify trailing whitespace-only text nodes. Preserve them
  // verbatim in the output — they're semantically part of mdast-util-to-
  // hast's expected shape and downstream serializers may rely on them.
  let trailingWsStart = children.length;
  while (trailingWsStart > 0 && isWhitespaceText(children[trailingWsStart - 1])) {
    trailingWsStart--;
  }
  // Step 2: scan backwards from the last non-whitespace child, peeling
  // backref anchors and their inter-backref `' '` separators.
  let scan = trailingWsStart;
  let peeledAny = false;
  while (scan > 0) {
    const t = children[scan - 1];
    if (!isBackrefAnchor(t)) break;
    peeledAny = true;
    scan -= 1;
    if (scan > 0 && children[scan - 1].type === 'text' && (children[scan - 1] as { value: string }).value === ' ') {
      scan -= 1;
    }
  }
  if (!peeledAny) return children;
  const trailing = children.slice(trailingWsStart);
  // Step 3: undo the merged-separator case. Trim exactly ONE trailing
  // space from the last surviving text node (matching footer.js's
  // `+= ' '`). Multiple trailing spaces stay intact — only the one
  // footer.js appended is ours to remove. Whitespace-only text nodes
  // (e.g. `\n`) don't qualify for trim — they aren't merged separators.
  if (scan > 0) {
    const last = children[scan - 1];
    if (last.type === 'text') {
      const v = (last as { value: string }).value;
      if (v.endsWith(' ') && !/^\s*$/.test(v)) {
        return [...children.slice(0, scan - 1), { ...last, value: v.slice(0, -1) } as ElementContent, ...trailing];
      }
    }
  }
  return [...children.slice(0, scan), ...trailing];
}

/**
 * Strip mdast-util-to-hast's auto-emitted backref anchors from a `<li>`
 * body. The library only ever appends backrefs in one of two locations:
 *   (a) directly at the end of the `<li>`'s children (after `state.wrap`
 *       interleaves whitespace nodes between block-level siblings), OR
 *   (b) at the end of the last `<p>` child of the `<li>`.
 * We handle both — and nothing else — to avoid stripping any
 * `data-footnote-backref`-shaped element that happens to live in user
 * content elsewhere in the def body.
 */
function stripBackrefs(liChildren: ElementContent[]): ElementContent[] {
  if (liChildren.length === 0) return liChildren;
  // Look past mdast-util-to-hast's trailing `\n` text node(s) to find the
  // meaningful tail. That tells us which of the two cases applies.
  const lastIdx = lastMeaningfulIdx(liChildren);
  if (lastIdx < 0) return liChildren;
  const last = liChildren[lastIdx];

  // Direct-into-li case (case A): meaningful tail IS the backref. Peel
  // from `<li>` children; dropTrailingBackrefs handles the trailing `\n`.
  if (isBackrefAnchor(last)) {
    return dropTrailingBackrefs(liChildren);
  }

  // Inside-<p> case (case B): meaningful tail is `<p>` and backrefs live
  // inside its inline children. `<p>` itself has no wrap-emitted whitespace
  // (state.wrap only fires for block-level lists), so dropTrailingBackrefs
  // can scan the `<p>`'s children directly. Preserve any trailing
  // whitespace nodes that follow the `<p>` in `<li>` exactly as-is.
  if (last.type === 'element' && (last as HastElement).tagName === 'p') {
    const p = last as HastElement;
    const newPChildren = dropTrailingBackrefs(p.children as ElementContent[]);
    if (newPChildren === p.children) return liChildren;
    return liChildren.map((c, i) => (i === lastIdx ? ({ ...p, children: newPChildren } as ElementContent) : c));
  }

  return liChildren;
}

/**
 * Walk `hast` and return a map from normalized footnote label to the
 * cleaned-up body hast of that label's `<li>`. The body has had any
 * `<a data-footnote-backref>` anchors removed at any nesting depth so the
 * aggregate footer can emit its own per-occurrence backrefs without
 * duplicating the locally-injected one.
 */
/**
 * Walk a body and clear `localOccurrence` props on any `<footnote-sup>`
 * placeholders we find. NESTED footnote refs inside a def body (`[^x]: see
 * [^y]`) emit placeholders whose `localOccurrence` is keyed to the parsing
 * chunk's `state.footnoteCounts`. When the aggregate footer renders the
 * harvested body under the LAST chunk's `ChunkSymbolContext.Provider`,
 * `globalOccurrenceForRef(lastChunkSym, label, localOccurrence)` resolves
 * against the wrong chunk — returning `null` and short-circuiting the
 * inline sup to render blank.
 *
 * The fix degrades gracefully: strip `localOccurrence` from harvested
 * placeholders so `FootnoteSupNumber` falls through to the
 * "no occurrence supplied" path — which renders a sup with the bare
 * `fnref-${label}` href (i.e. the first-occurrence anchor). Backref
 * navigation still works (any occurrence href is valid for "jump back");
 * the only loss is occurrence-precision for nested footnote refs in
 * aggregate-rendered bodies, which is an edge case GFM permits but rarely
 * exercised in practice. The PRIMARY render (the originating chunk's own
 * block output) is unaffected — it still has the full localOccurrence
 * resolved against the correct chunk symbol.
 */
function stripLocalOccurrenceFromFootnoteSups(children: ElementContent[]): ElementContent[] {
  let changed = false;
  const out: ElementContent[] = [];
  for (const c of children) {
    if (c.type === 'element') {
      const el = c as HastElement;
      let nextEl: HastElement = el;
      if (el.tagName === 'footnote-sup' && el.properties && 'localOccurrence' in el.properties) {
        const { localOccurrence: _drop, ...rest } = el.properties;
        nextEl = { ...el, properties: rest };
        changed = true;
      }
      // Recurse into element children to catch nested placeholders.
      const newChildren = stripLocalOccurrenceFromFootnoteSups(nextEl.children as ElementContent[]);
      if (newChildren !== nextEl.children) {
        nextEl = { ...nextEl, children: newChildren };
        changed = true;
      }
      out.push(nextEl);
    } else {
      out.push(c);
    }
  }
  return changed ? out : children;
}

export function extractDefBodiesFromHast(hast: HastRoot, clobberPrefix?: string): Map<string, ElementContent[]> {
  const out = new Map<string, ElementContent[]>();
  visit(hast, 'element', (sectionNode) => {
    const sec = sectionNode as HastElement;
    if (sec.tagName !== 'section') return;
    if (!(sec.properties && 'dataFootnotes' in sec.properties)) return;
    visit(sec, 'element', (liNode) => {
      const li = liNode as HastElement;
      if (li.tagName !== 'li') return;
      const idProp = li.properties?.id;
      if (typeof idProp !== 'string') return;
      const sourceId = sourceIdFromFootnoteLiId(idProp, clobberPrefix);
      if (sourceId === null) return;
      const normalized = normalizeId(sourceId);
      const stripped = stripBackrefs(li.children as ElementContent[]);
      // Defuse any nested `<footnote-sup>` placeholders whose local
      // occurrence indices belong to a different chunk than where the
      // body will eventually be rendered. See the function's JSDoc.
      out.set(normalized, stripLocalOccurrenceFromFootnoteSups(stripped));
    });
    // SKIP descent into this section's children so a NESTED
    // `<section data-footnotes>` (rare — produced only via user-supplied
    // raw HTML inside a def body that survives rehype-raw + sanitize)
    // isn't double-processed by both the outer visit's recursion and the
    // inner visit's enumeration of its parent. Without the SKIP, an
    // `<li>` inside the nested section is harvested twice; `out.set` is
    // last-write-wins so a nested mutation can stomp a correctly-
    // extracted outer body. SKIP scopes harvest to the outer section
    // and leaves nested footnote sections for whatever tool authored
    // them to handle.
    return SKIP;
  });
  return out;
}
