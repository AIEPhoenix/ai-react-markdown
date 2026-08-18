/**
 * Streaming cursor — positioner shell and default indicator.
 *
 * The shell (`AIMarkdownStreamingCursor`) is a self-contained component
 * mounted via the `streamingCursor` slot on `<AIMarkdown>`. It never moves
 * in the React tree; what moves is the visual position of the indicator:
 * the shell detects the last character of the rendered content, measures it
 * with the Range API, and translates an absolutely-positioned holder to sit
 * right after it. Pixels are moved, not DOM nodes — the shell never enters
 * any React-managed container, so there is no DOM-ownership friction and
 * select-all/copy never picks the cursor up.
 *
 * Engine coupling is zero by construction: the content string, the parse
 * pipeline (hast, splice contract), and the block-memo cache are untouched.
 * Worst cases are cosmetic (a one-frame offset, a conservative hide) and
 * self-heal on the next observer callback.
 *
 * Update channels (see docs/proposals/streaming-cursor.md):
 * - Position (x, y) never enters React state. It changes on every token and
 *   must land in the same frame as the content change, so it is applied
 *   imperatively inside the observer callback — MutationObserver callbacks
 *   run as microtasks BEFORE paint, which is what makes the reposition
 *   flicker-free.
 * - `width`/`height` enter indicator props with an equality short-circuit.
 * - `lastMutationAt` updates once per mutation batch; the indicator is a
 *   leaf, so the per-token leaf re-render is negligible and lets the
 *   indicator reset its stall timer with a plain `useEffect`.
 *
 * @module components/streamingCursor
 */

import { useEffect, useInsertionEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { detectAnchorTextNode } from './detectAnchor';

/** Props the shell injects into the indicator (the actual visual layer). */
export interface AIMarkdownStreamingIndicatorProps {
  /**
   * Rendered height (px) of the last character at the anchor. Indicators
   * use it to match the current line's text size — taller on headings,
   * shorter on body text.
   */
  height: number;
  /**
   * Rendered width (px) of the last character at the anchor. Block-style
   * cursors (e.g. `▍`) can use it to align with the character cell.
   */
  width: number;
  /** Timestamp of the most recent content mutation (`performance.now()` basis). */
  lastMutationAt: number;
}

export type AIMarkdownStreamingIndicatorComponent = ComponentType<AIMarkdownStreamingIndicatorProps>;

export interface AIMarkdownStreamingCursorProps {
  /**
   * The indicator component the shell positions and feeds with
   * {@link AIMarkdownStreamingIndicatorProps}. Defaults to the built-in
   * blinking circle. Bind a custom one at module scope:
   *
   * ```tsx
   * const MyCursor = () => <AIMarkdownStreamingCursor indicator={MyIndicator} />;
   * <AIMarkdown streamingCursor={MyCursor} ... />
   * ```
   */
  indicator?: AIMarkdownStreamingIndicatorComponent;
}

/** Horizontal gap (px) between the last character and the indicator. */
const ANCHOR_GAP = 4;

/** Stall threshold of the DEFAULT indicator. Internal detail, not API. */
const STALL_MS = 5000;

const WRAPPER_STYLE: CSSProperties = {
  position: 'relative',
  display: 'block',
  width: '100%',
  height: 0,
  margin: 0,
  padding: 0,
};

/**
 * All positioning keys (`display`, `transform`, `left`, `right`) are
 * written imperatively in `measure()`/`hide()` and deliberately do NOT
 * appear in this style object — React's style diff only touches keys it
 * has seen in the prop, so it can never clobber the imperative values, no
 * matter how the object is created. Before the first measurement the
 * holder is empty (the indicator mounts only once an anchor state exists),
 * so nothing is visible without an explicit `display: none`.
 */
const HOLDER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  pointerEvents: 'none',
};

const STYLE_MARKER = 'data-aimd-streaming-cursor-style';
/**
 * Marker VALUE = a fingerprint of the injected rules. Two library versions
 * on one page (micro-frontends, duplicated installs) each dedupe on their
 * own fingerprint, so a version that changes the rules injects its own tag
 * instead of silently inheriting the first-mounted version's. The animation
 * names carry the same suffix — CSS resolves `@keyframes` by name
 * globally, so a same-name/different-body pair would still race (2026-08
 * project review, core-render-07). Bump the fingerprint whenever the
 * keyframes change.
 */
const STYLE_FINGERPRINT = 'v2'; // v2: keyframe names carry the suffix (2.4.2)
/** Animation names DERIVE from the fingerprint, so bumping it versions
 *  the keyframes too — the cross-version isolation no longer rests on
 *  remembering to rename them by hand (v2.4.1 review). */
const BLINK_ANIMATION = `aimd-streaming-cursor-blink-${STYLE_FINGERPRINT}`;
const SPIN_ANIMATION = `aimd-streaming-cursor-spin-${STYLE_FINGERPRINT}`;

const CURSOR_KEYFRAMES =
  `@keyframes ${BLINK_ANIMATION}{0%,100%{opacity:1}50%{opacity:.15}}` +
  `@keyframes ${SPIN_ANIMATION}{to{transform:rotate(360deg)}}` +
  // Reduced motion: freeze blink/spin and state transitions. The static
  // dot/ring still convey streaming vs stalled without movement.
  '@media (prefers-reduced-motion:reduce){[data-aimd-streaming-indicator] span,[data-aimd-streaming-indicator]{animation:none!important;transition:none!important}}';

/**
 * Injects the cursor keyframes into `document.head` once per document.
 * `useInsertionEffect` runs before layout effects (and never on the
 * server), so the rules exist before anything measures. The tag is
 * deliberately never removed on unmount: orphan keyframes are inert, and
 * refcounting unmounts buys nothing (standard CSS-in-JS practice).
 *
 * Trade-off vs the previous inline `<style>`-per-instance: N concurrent
 * streaming messages now share ONE tag instead of N duplicates. Known
 * boundaries: a Shadow DOM host doesn't see `document.head` styles, and a
 * component portaled into an iframe injects into the PARENT document's
 * head (module-global `document`), not the iframe's — in either case,
 * mount a self-styled custom indicator (the shell itself is style-free).
 */
function useCursorKeyframes() {
  useInsertionEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.head.querySelector(`style[${STYLE_MARKER}="${STYLE_FINGERPRINT}"]`)) return;
    const tag = document.createElement('style');
    tag.setAttribute(STYLE_MARKER, STYLE_FINGERPRINT);
    tag.textContent = CURSOR_KEYFRAMES;
    document.head.appendChild(tag);
  }, []);
}

interface AnchorMeasure {
  rect: DOMRect;
  rtl: boolean;
}

/**
 * Measure the last non-whitespace character of the anchor text node.
 * Selects the character (not a collapsed end-point) because collapsed
 * ranges return an empty `getClientRects()` list in some engines; the last
 * rect wins when the character straddles a soft wrap. Returns null when the
 * environment cannot measure (jsdom) or the rect is degenerate.
 */
function measureAnchor(anchor: Text): AnchorMeasure | null {
  const data = anchor.data;
  const trimmedLength = data.replace(/\s+$/, '').length;
  if (trimmedLength === 0) return null;
  const doc = anchor.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return null;
  // Range offsets are UTF-16 code units. An emoji tail (astral plane) would
  // otherwise select only the low surrogate and measure a degenerate
  // half-glyph rect — step back to the full code point. Multi-code-point
  // grapheme clusters (ZWJ sequences, combining marks) still anchor to
  // their last code point; acceptable, the rect stays on the glyph.
  let start = trimmedLength - 1;
  const lastUnit = data.charCodeAt(trimmedLength - 1);
  if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && trimmedLength >= 2) {
    const prevUnit = data.charCodeAt(trimmedLength - 2);
    if (prevUnit >= 0xd800 && prevUnit <= 0xdbff) start = trimmedLength - 2;
  }
  let rects: DOMRectList;
  try {
    const range = doc.createRange();
    range.setStart(anchor, start);
    range.setEnd(anchor, trimmedLength);
    rects = range.getClientRects();
  } catch {
    // Range measurement unavailable (e.g. jsdom) — hide rather than guess.
    return null;
  }
  if (!rects || rects.length === 0) return null;
  const rect = rects[rects.length - 1];
  if (rect.width === 0 && rect.height === 0) return null;
  const parent = anchor.parentElement;
  const rtl = parent ? win.getComputedStyle(parent).direction === 'rtl' : false;
  return { rect, rtl };
}

/**
 * Default indicator: a blinking circle whose diameter tracks the line
 * height. After {@link STALL_MS} of silence it cross-fades into a rotating
 * ring (spinner) in the two-tone style of the reference demo: a muted
 * full-circle track plus a full-strength top segment that rotates. Blinking
 * pauses while the ring spins — a spinner communicates "waiting" on its
 * own — and the filled blinking circle returns as soon as content flows
 * again.
 */
function DefaultStreamingIndicator({ height, lastMutationAt }: AIMarkdownStreamingIndicatorProps) {
  // `stalled` is derived, not set: the timer only records WHEN the stall
  // verdict fired. The condition requires the verdict to be a full
  // STALL_MS after the CURRENT `lastMutationAt` — not merely after it —
  // which closes a race: a timer armed for an old prop can fire in the
  // window between a fresh mutation and this effect's cleanup, and a bare
  // `stalledSince > lastMutationAt` would then declare a stall 1 ms into
  // active streaming. A newer mutation always un-stalls without any state
  // write (and without a synchronous setState in the effect body, which
  // react-hooks forbids).
  useCursorKeyframes();
  const [stalledSince, setStalledSince] = useState<number | null>(null);
  const stalled = stalledSince !== null && stalledSince >= lastMutationAt + STALL_MS;
  useEffect(() => {
    // Chromium can fire timers marginally EARLY relative to
    // `performance.now()`. A single-shot timer stamping `now` would then
    // fail the deadline check by a fraction of a millisecond and never
    // retry — a sub-millisecond coin flip that silently kills the stall
    // state (found as a flaky StallRecovery story). So: re-check on fire
    // and re-arm while the deadline hasn't truly passed, then stamp the
    // DEADLINE itself — exact for this `lastMutationAt`, and still
    // fail-closed against any newer mutation's later deadline.
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const remaining = STALL_MS - (performance.now() - lastMutationAt);
      if (remaining <= 0) {
        setStalledSince(lastMutationAt + STALL_MS);
        return;
      }
      timer = setTimeout(arm, Math.max(1, Math.ceil(remaining)));
    };
    timer = setTimeout(arm, Math.max(0, Math.ceil(STALL_MS - (performance.now() - lastMutationAt))));
    return () => clearTimeout(timer);
  }, [lastMutationAt]);

  const size = Math.max(4, Math.round(height * 0.45));
  // Symmetric horizontal breathing room around the dot, reserved INSIDE the
  // indicator's box (constant layout, direction-agnostic). When the spinner
  // takes over it grows to exactly fill this reserved space — "growing by
  // eating the whitespace" — so the enlargement is pure transform and the
  // outer footprint never changes.
  const sideGap = Math.max(2, Math.round(size * 0.25));
  // The ring is authored at its FINAL diameter with a thin border and
  // parked scaled-DOWN while the dot shows. Settling at scale(1) keeps the
  // border at its exact CSS width — scaling a small ring UP would multiply
  // (and blur) the border, which reads as chunky. The grown ring does NOT
  // consume the whole reserved gap: a sliver (`edgeKeep`, ~1/3 of the gap)
  // stays as breathing room around the spinner.
  const edgeKeep = Math.max(1, Math.round(sideGap / 3));
  const ringGrow = sideGap - edgeKeep;
  const ringDiameter = size + 2 * ringGrow;
  const ringWidth = Math.max(1.5, Math.round(ringDiameter * 0.12));
  const ringRestScale = Math.round((size / ringDiameter) * 100) / 100;
  // Stacked layers cross-faded by opacity (compositor-friendly — no layout
  // property is ever animated). The demo's two-tone spinner (muted
  // `--border-strong` track + accent `--fill-primary` top segment) is
  // decomposed into a static 25%-opacity track ring and a rotating
  // full-strength top-segment ring, so the whole visual stays
  // currentColor-only with no color-mix dependency. The two rings live in a
  // group that owns fade and scale, so the top segment's spin animation
  // never competes for the same `transform`. The dot's blink animation is
  // disabled while stalled so the opacity transition owns the property.
  const ringLayer: CSSProperties = {
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: ringWidth,
  };
  return (
    <span
      data-aimd-streaming-indicator=""
      data-stalled={stalled ? '' : undefined}
      style={{
        display: 'block',
        position: 'relative',
        width: size + 2 * sideGap,
        height: size,
        marginTop: Math.round((height - size) / 2),
        userSelect: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: sideGap,
          top: 0,
          width: size,
          height: size,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            backgroundColor: 'currentColor',
            opacity: stalled ? 0 : 1,
            transition: 'opacity 300ms ease',
            animation: stalled ? 'none' : `${BLINK_ANIMATION} 900ms ease-in-out infinite`,
          }}
        />
        <span
          style={{
            position: 'absolute',
            inset: -ringGrow,
            opacity: stalled ? 1 : 0,
            transform: stalled ? 'scale(1)' : `scale(${ringRestScale})`,
            transition: 'opacity 300ms ease, transform 300ms ease',
          }}
        >
          <span
            style={{
              ...ringLayer,
              borderColor: 'currentColor',
              opacity: 0.25,
            }}
          />
          <span
            data-aimd-streaming-indicator-ring=""
            style={{
              ...ringLayer,
              borderColor: 'transparent',
              borderTopColor: 'currentColor',
              animation: stalled ? `${SPIN_ANIMATION} 800ms linear infinite` : 'none',
            }}
          />
        </span>
      </span>
    </span>
  );
}

/**
 * Positioner shell. Renders a zero-height wrapper (the coordinate base and
 * the handle to the content root via `parentElement`), detects the anchor,
 * and keeps the indicator positioned through three pre-paint signal
 * sources: a MutationObserver on the content root (tokens, tail-block
 * morphs), a ResizeObserver (reflow from container width changes), and
 * `document.fonts.ready` (one re-measure after font swap). Detection
 * failure hides the indicator; the next mutation re-detects.
 *
 * SSR renders the (invisible) wrapper only — detection needs a real DOM, so
 * the indicator appears after the first client-side measurement.
 */
export const AIMarkdownStreamingCursor = ({
  indicator: Indicator = DefaultStreamingIndicator,
}: AIMarkdownStreamingCursorProps) => {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const holderRef = useRef<HTMLSpanElement>(null);
  const [anchorState, setAnchorState] = useState<AIMarkdownStreamingIndicatorProps | null>(null);
  const anchorStateRef = useRef<AIMarkdownStreamingIndicatorProps | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const root = wrapper?.parentElement;
    if (!wrapper || !root) return;

    const hide = () => {
      const holder = holderRef.current;
      if (holder) holder.style.display = 'none';
      if (anchorStateRef.current !== null) {
        anchorStateRef.current = null;
        setAnchorState(null);
      }
    };

    const measure = (isMutation: boolean) => {
      const holder = holderRef.current;
      if (!holder) return;
      const anchor = detectAnchorTextNode(root, wrapper);
      const measured = anchor && measureAnchor(anchor);
      if (!measured) {
        hide();
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();
      // Ancestor `transform: scale` correction: client rects are measured in
      // post-transform pixels, but `translate()` applies in the wrapper's
      // LOCAL units — under a scaled ancestor (entrance animations, zoom
      // wrappers) the raw delta would be scaled twice. `offsetWidth` is the
      // local layout width, so the ratio recovers the effective scale.
      // Rotation/skew ancestors remain unsupported (see proposal, 已知边界).
      const localWidth = wrapper.offsetWidth;
      const scale = localWidth > 0 && wrapperRect.width > 0 ? wrapperRect.width / localWidth : 1;
      if (!Number.isFinite(scale) || scale <= 0) {
        hide();
        return;
      }
      const { rect, rtl } = measured;
      const maxX = wrapper.clientWidth;
      let x: number;
      if (rtl) {
        // Right-anchor: the holder's RIGHT edge lands at (char left − gap),
        // so the indicator grows leftward, away from the text. With
        // `left: auto; right: 0` the untranslated right edge sits at the
        // wrapper's right edge; the translate is the (negative) distance
        // from there, in local units.
        x = (rect.left - ANCHOR_GAP - wrapperRect.right) / scale;
        if (maxX > 0) x = Math.min(0, Math.max(x, -(maxX - 1)));
        holder.style.left = 'auto';
        holder.style.right = '0px';
      } else {
        x = (rect.right + ANCHOR_GAP - wrapperRect.left) / scale;
        if (maxX > 0) x = Math.max(0, Math.min(x, maxX - 1));
        holder.style.left = '0px';
        holder.style.right = 'auto';
      }
      const y = (rect.top - wrapperRect.top) / scale;
      holder.style.display = 'block';
      holder.style.transform = `translate(${x}px, ${y}px)`;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const prev = anchorStateRef.current;
      const lastMutationAt = isMutation || !prev ? performance.now() : prev.lastMutationAt;
      if (!prev || prev.width !== width || prev.height !== height || prev.lastMutationAt !== lastMutationAt) {
        const next = { width, height, lastMutationAt };
        anchorStateRef.current = next;
        setAnchorState(next);
      }
    };

    measure(true);

    const mutationObserver = new MutationObserver((records) => {
      // The shell's own subtree mutates when the indicator mounts/unmounts;
      // those records must not reset the stall clock or re-trigger work.
      if (records.every((record) => wrapper.contains(record.target))) return;
      measure(true);
    });
    // Two documented semantics of this observer:
    // - The stall clock counts ANY non-wrapper mutation under the content
    //   root as activity (a mermaid repaint, a coordinated footer
    //   re-render) — "the message is alive", not strictly "new tokens
    //   arrived".
    // - Attribute-only changes are a known blind spot: a class swap that
    //   re-wraps text without childList/characterData records moves the
    //   anchor with no callback; the cursor self-heals on the next
    //   mutation. `attributes: true` was deliberately not enabled — it
    //   would fire on every imperative style write of sibling instances.
    mutationObserver.observe(root, { childList: true, characterData: true, subtree: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => measure(false));
      resizeObserver.observe(root);
    }

    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) measure(false);
    });

    return () => {
      cancelled = true;
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, []);

  return (
    <span ref={wrapperRef} data-aimd-streaming-cursor="" aria-hidden="true" style={WRAPPER_STYLE}>
      <span ref={holderRef} style={HOLDER_STYLE}>
        {anchorState ? <Indicator {...anchorState} /> : null}
      </span>
    </span>
  );
};
