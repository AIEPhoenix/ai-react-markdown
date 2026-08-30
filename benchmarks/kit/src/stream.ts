/**
 * The delivery loop, extracted because BOTH apps must drive a scenario the
 * same way or their numbers are not comparable.
 *
 * It is written as a plain subscribe function rather than a React hook so
 * that a future non-React adapter can use it unchanged — the React wrapper
 * around it lives in each app, where React belongs.
 */
import type { Scenario } from './scenarios';

export interface StreamHandle {
  cancel(): void;
}

/** Feed `scenario` to `onContent`, one tick at a time, then call `onDrained`.
 *  Ticks are scheduled with setTimeout rather than rAF on purpose: arrival
 *  rate is the independent variable here, and rAF would couple it to the
 *  very frame budget being measured. */
export interface DriveOptions {
  /**
   * Synthetic main-thread work, in milliseconds, burned before each chunk is
   * handed to the renderer.
   *
   * This is the benchmark's OWN anti-vacuity control, not a feature. A
   * benchmark that cannot be shown to notice a slowdown is decoration, and
   * the only way to show it is to introduce a slowdown of known size and
   * watch the numbers move. `runner/selftest.mjs` does exactly that and fails
   * if they do not.
   *
   * It burns rather than sleeps on purpose: `await sleep()` yields the thread
   * and would lengthen the stream without touching frame pacing or long
   * tasks, so a harness blind to blocking work would still pass.
   */
  handicapMs?: number;
}

function burn(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* deliberate busy-wait — see handicapMs */
  }
}

export function driveScenario(
  scenario: Scenario,
  onContent: (next: string) => void,
  onDrained: () => void,
  options: DriveOptions = {}
): StreamHandle {
  let i = 0;
  let at = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  let raf = 0;
  // MessageChannel, not `setTimeout(0)`: browsers clamp nested timeouts to
  // 4 ms after a few levels, which would put a 4 ms floor under every chunk
  // and reintroduce exactly the pacing bound this mode exists to remove.
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = () => tick();

  const tick = (): void => {
    if (cancelled) return;
    if (i >= scenario.chunks.length) {
      onDrained();
      return;
    }
    at += scenario.chunks[i];
    i += 1;
    if (options.handicapMs !== undefined && options.handicapMs > 0) burn(options.handicapMs);
    // Backwards: take the LAST `at` characters, so each chunk prepends and
    // everything already on screen is pushed down.
    onContent(scenario.content.slice(0, at));
    // `frame` pacing hands the next chunk over on the next animation frame,
    // so a renderer that takes longer to paint is fed more slowly and the
    // stream lengthens by exactly what it cost. `timer` pacing keeps a fixed
    // arrival rate regardless.
    if (scenario.pacing === 'frame') raf = requestAnimationFrame(tick);
    else if (scenario.pacing === 'immediate') port.postMessage(null);
    else timer = setTimeout(tick, scenario.tickMs);
  };

  tick();
  return {
    cancel(): void {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (raf !== 0) cancelAnimationFrame(raf);
      channel.port1.onmessage = null;
      channel.port1.close();
      port.close();
    },
  };
}
