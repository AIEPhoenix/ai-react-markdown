/**
 * React binding for the smooth-stream controller.
 *
 * The return value is deliberately props-shaped: `{ content, streaming }`
 * mirrors the `<AIMarkdown>` props of the same names, so the result
 * spreads into the base component or ANY wrapper (mantine included) in
 * one line:
 *
 * ```tsx
 * const smooth = useSmoothStream({ content, streaming: !done });
 * return <MantineAIMarkdown {...smooth} />;
 * ```
 *
 * Semantics:
 * - Mount snaps to the current `content` — SSR hydration and mid-stream
 *   remounts (route return, list virtualization) show the full text
 *   instantly instead of replaying the typewriter from empty.
 * - While `streaming` is true, content growth animates.
 * - On the `streaming` true→false transition the controller drains the
 *   remaining backlog within its rate-continuity drain window (at most
 *   `3 × drainMs`); the RETURNED `streaming` stays true until drained so
 *   the cursor slot doesn't unmount mid-animation.
 * - Content changes while not streaming snap (no animation).
 *
 * @module components/smoothStream/useSmoothStream
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  createSmoothStreamController,
  type SmoothStreamOptions,
  type SmoothStreamPacing,
} from '@ai-react-markdown/engine';

export interface UseSmoothStreamOptions {
  /** Full accumulated markdown source (the same value you would pass to `content`). */
  content: string;
  /** Whether the stream is still producing (the same value you would pass to `streaming`). */
  streaming?: boolean;
  /**
   * Named pacing preset — the whole tuning surface at this level:
   * `'smooth'` (extra buffer, never runs dry), `'balanced'` (default,
   * minimal lag that still bridges typical bursts), `'responsive'`
   * (lowest lag, accepts occasional pauses). Numeric parameters live on
   * {@link createSmoothStreamController} for advanced hosts.
   */
  pacing?: SmoothStreamPacing;
  /**
   * Fires when the post-stream drain completes — the message is now
   * fully visible. In practice this is end-of-stream only (the held-back
   * trailing grapheme keeps the reveal one step short of a LIVE stream,
   * so mid-stream catch-ups never count as drained); multi-round flows
   * fire it once per round. Content replacement (regeneration) does NOT
   * fire it — the replaced message never "completed". Read through a
   * latest-ref: identity changes are safe and never re-trigger anything.
   */
  onDrained?: () => void;
  /** @internal test seam — injectable clock, see {@link SmoothStreamOptions.now}. */
  now?: SmoothStreamOptions['now'];
  /** @internal test seam — injectable scheduler, see {@link SmoothStreamOptions.schedule}. */
  schedule?: SmoothStreamOptions['schedule'];
}

export interface UseSmoothStreamResult {
  /** The paced (revealed-prefix) content — pass as `content`. */
  content: string;
  /** True while pixels should still read as streaming — pass as `streaming`. */
  streaming: boolean;
  /**
   * Reveals everything pending immediately (a "skip animation" button).
   * Identity-stable; safe to pass down memoized trees. Spreading it onto
   * a component is harmless — the base components ignore unknown props.
   */
  flush: () => void;
}

export const useSmoothStream = ({
  content,
  streaming = false,
  pacing,
  onDrained,
  now,
  schedule,
}: UseSmoothStreamOptions): UseSmoothStreamResult => {
  // Live options object: the controller reads the preset at tick time, so
  // refreshing the field (in the every-render effect below) retunes
  // pacing without controller churn. It lives in state, not a ref, so the
  // construction path never reads a ref during render.
  const [{ controller, liveOptions }] = useState(() => {
    const initial: SmoothStreamOptions = { pacing, now, schedule };
    const created = createSmoothStreamController(initial);
    created.snap(content);
    return { controller: created, liveOptions: initial };
  });

  const onDrainedRef = useRef(onDrained);
  useEffect(() => {
    // Every-render sync: latest callback + live preset retune. An explicit
    // write (not Object.assign) so a preset the caller STOPS passing falls
    // back to the controller default instead of sticking. `liveOptions` is
    // not render state — it is the deliberately mutable channel the
    // controller reads at tick time (its identity is fixed for the
    // component's lifetime), so the immutability rule's premise doesn't
    // apply here.
    onDrainedRef.current = onDrained;
    // eslint-disable-next-line react-hooks/immutability
    liveOptions.pacing = pacing;
  });

  // Drained-edge latch (armed = "currently caught up"). Declared before
  // the reaction effect below, which pre-arms it on content replacement.
  const wasDrainedRef = useRef(true);

  const prevStreamingRef = useRef(false);
  const prevContentRef = useRef(content);
  useEffect(() => {
    // Content replacement (not an append-extension) means the animating
    // message was aborted, not completed: pre-arm the drained latch so the
    // snap inside the controller can't fire a spurious onDrained for it.
    if (!content.startsWith(prevContentRef.current)) wasDrainedRef.current = true;
    prevContentRef.current = content;

    if (streaming) {
      controller.update(content);
    } else if (prevStreamingRef.current) {
      // Stream just ended: make sure the final text is in, then drain.
      controller.update(content);
      controller.finish();
    } else {
      controller.snap(content);
    }
    prevStreamingRef.current = streaming;

    // Arm the drained latch on BACKLOG FORMATION, not on the first
    // un-drained notify: update() is silent, so a round whose only notify
    // is the drain itself (single-grapheme append; a background tab's
    // mega-reveal) would otherwise find the latch still armed-off from
    // the previous round and swallow its onDrained. Mid-stream notifies
    // can never read drained (the held-back tail keeps the reveal short
    // of a live source), so arming here cannot cause a mid-stream fire —
    // and after a replacement, snap() leaves the controller drained, so
    // the pre-arm above is never overridden.
    if (!controller.isDrained()) wasDrainedRef.current = false;
  }, [controller, content, streaming]);

  // Drained-edge detection: fire onDrained only when a real backlog
  // catches up, not on every static snap (those never leave the drained
  // state, so the edge never arms).
  useEffect(
    () =>
      controller.subscribe(() => {
        const drained = controller.isDrained();
        if (drained && !wasDrainedRef.current) onDrainedRef.current?.();
        wasDrainedRef.current = drained;
      }),
    [controller]
  );

  // Cleanup disposes; StrictMode's dev-only replay then REUSES this same
  // controller — the replayed effects above (update/snap) and the uSES
  // resubscribe revive it, rescheduling any surviving backlog. After a
  // real unmount nothing calls back in, so disposal sticks.
  useEffect(() => () => controller.dispose(), [controller]);

  const visible = useSyncExternalStore(
    controller.subscribe,
    controller.getVisible,
    // Server snapshot: the full content. Client mount snaps to the same
    // value, so hydration sees identical text.
    () => content
  );

  const flush = useCallback(() => controller.flush(), [controller]);

  return {
    content: visible,
    streaming: streaming || visible.length < content.length,
    flush,
  };
};
