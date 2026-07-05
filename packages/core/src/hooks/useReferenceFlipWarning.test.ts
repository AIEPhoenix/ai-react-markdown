import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { trackFlip, type FlipState } from './useReferenceFlipWarning';

describe('trackFlip — pure flip-and-rate-limit logic', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  function fresh(initial: unknown): FlipState {
    // Mirror the production seed: -Infinity ensures the first warn-eligible
    // event is never blocked by the cooldown comparison.
    return { prev: initial, flipTimes: [], consecutiveFlips: 0, lastFlipAt: -Infinity, lastWarnAt: -Infinity };
  }

  test('does not warn when the value is unchanged', () => {
    const stable = { k: 1 };
    const s = fresh(stable);
    trackFlip(s, stable, 'urlTransform', 1000);
    trackFlip(s, stable, 'urlTransform', 2000);
    trackFlip(s, stable, 'urlTransform', 3000);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(s.flipTimes).toHaveLength(0);
  });

  test('does not warn for a single identity flip', () => {
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'urlTransform', 1000);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(s.flipTimes).toHaveLength(1);
  });

  test('warns once after exactly 3 identity flips', () => {
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'urlTransform', 1000);
    trackFlip(s, { k: 2 }, 'urlTransform', 2000);
    expect(warnSpy).not.toHaveBeenCalled();
    trackFlip(s, { k: 3 }, 'urlTransform', 3000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('urlTransform');
    expect(msg).toContain('module scope');
  });

  test('rate-limits subsequent warnings within the cooldown window', () => {
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'urlTransform', 1000);
    trackFlip(s, { k: 2 }, 'urlTransform', 1100);
    trackFlip(s, { k: 3 }, 'urlTransform', 1200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Within the cooldown window: more flips do not produce more warns.
    trackFlip(s, { k: 4 }, 'urlTransform', 1300);
    trackFlip(s, { k: 5 }, 'urlTransform', 2000);
    trackFlip(s, { k: 6 }, 'urlTransform', 5000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('warns again after the cooldown window elapses', () => {
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'urlTransform', 1000);
    trackFlip(s, { k: 2 }, 'urlTransform', 1100);
    trackFlip(s, { k: 3 }, 'urlTransform', 1200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Past the 5s cooldown.
    trackFlip(s, { k: 4 }, 'urlTransform', 6300);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test('uses the prop name in the warning text', () => {
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'sanitizeSchema', 1000);
    trackFlip(s, { k: 2 }, 'sanitizeSchema', 2000);
    trackFlip(s, { k: 3 }, 'sanitizeSchema', 3000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('sanitizeSchema');
  });

  test('treats undefined → undefined as no flip', () => {
    const s = fresh(undefined);
    trackFlip(s, undefined, 'urlTransform', 1000);
    trackFlip(s, undefined, 'urlTransform', 2000);
    trackFlip(s, undefined, 'urlTransform', 3000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('threshold counts flips, not renders — stable runs in between do not reset', () => {
    const stable = { k: 99 };
    const s = fresh(stable);
    trackFlip(s, stable, 'urlTransform', 100);
    trackFlip(s, { k: 1 }, 'urlTransform', 200);
    trackFlip(s, stable, 'urlTransform', 300);
    trackFlip(s, { k: 2 }, 'urlTransform', 400);
    trackFlip(s, stable, 'urlTransform', 500);
    trackFlip(s, { k: 3 }, 'urlTransform', 600);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('decay: flips spread across a long session never warn', () => {
    // Regression: the old cumulative counter warned as soon as the 3rd flip
    // EVER happened — three legitimate identity changes minutes apart
    // (feature flags, route transitions) tripped the "changing on every
    // render" warning. Flips outside the recency window must not count.
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'urlTransform', 0);
    trackFlip(s, { k: 2 }, 'urlTransform', 60_000);
    trackFlip(s, { k: 3 }, 'urlTransform', 120_000);
    trackFlip(s, { k: 4 }, 'urlTransform', 180_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('decay: a rapid burst after a quiet period still warns', () => {
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'urlTransform', 0); // lone legitimate change
    trackFlip(s, { k: 2 }, 'urlTransform', 60_000); // another, much later
    trackFlip(s, { k: 3 }, 'urlTransform', 60_100);
    // Oldest tracked flip (0ms) is outside the window — no warn yet.
    expect(warnSpy).not.toHaveBeenCalled();
    trackFlip(s, { k: 4 }, 'urlTransform', 60_200);
    // Now the last 3 flips (60_000 / 60_100 / 60_200) fit the window.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('sustained: every-render churn slower than the window still warns', () => {
    // Regression: a 6s polling dashboard passing an inline prop flips on
    // 100% of renders (the exact pathology this hook diagnoses) but never
    // fits 3 flips into the 10s recency window — the consecutive-run
    // trigger must catch it regardless of wall-clock spacing.
    const s = fresh({ k: 0 });
    for (let i = 1; i <= 5; i++) {
      trackFlip(s, { k: i }, 'urlTransform', i * 6000);
    }
    expect(warnSpy).not.toHaveBeenCalled(); // 5 consecutive — below sustained threshold
    trackFlip(s, { k: 6 }, 'urlTransform', 36_000);
    expect(warnSpy).toHaveBeenCalledTimes(1); // 6th consecutive flipping render
  });

  test('sustained: StrictMode double-invoke does not reset the run', () => {
    // StrictMode calls the render function twice per committed render with
    // the SAME value — the second call of the (flip, same-value) pair lands
    // in the same millisecond and must not count as a stable render, or the
    // sustained trigger would be permanently disarmed exactly where it
    // matters most (dev with StrictMode on).
    const s = fresh({ k: 0 });
    for (let i = 1; i <= 6; i++) {
      const v = { k: i };
      const t = i * 6000;
      trackFlip(s, v, 'urlTransform', t); // first invoke: flip
      trackFlip(s, v, 'urlTransform', t); // double-invoke mirror: same value, same ms
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('sustained: a stable render resets the consecutive-flip run', () => {
    const s = fresh({ k: 0 });
    let last: unknown;
    for (let i = 1; i <= 5; i++) {
      last = { k: i };
      trackFlip(s, last, 'urlTransform', i * 6000);
    }
    // One render with a stable identity — the run ends.
    trackFlip(s, last, 'urlTransform', 36_000);
    // Five more slow flips: run restarts at 1, never reaches the threshold.
    for (let i = 10; i <= 14; i++) {
      trackFlip(s, { k: i }, 'urlTransform', i * 6000);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
