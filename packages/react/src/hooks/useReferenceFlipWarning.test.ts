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
    return { prev: initial, flips: 0, lastWarnAt: -Infinity };
  }

  test('does not warn when the value is unchanged', () => {
    const stable = { k: 1 };
    const s = fresh(stable);
    trackFlip(s, stable, 'urlTransform', 1000);
    trackFlip(s, stable, 'urlTransform', 2000);
    trackFlip(s, stable, 'urlTransform', 3000);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(s.flips).toBe(0);
  });

  test('does not warn for a single identity flip', () => {
    const s = fresh({ k: 0 });
    trackFlip(s, { k: 1 }, 'urlTransform', 1000);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(s.flips).toBe(1);
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

  test('flips further apart than the window are legitimate changes — the count restarts (core-api-06)', () => {
    const s = fresh({ k: 0 });
    // Three flips minutes apart: never "changing on every render".
    trackFlip(s, { k: 1 }, 'urlTransform', 1000);
    trackFlip(s, { k: 2 }, 'urlTransform', 61_000);
    trackFlip(s, { k: 3 }, 'urlTransform', 121_000);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(s.flips).toBe(1);
    // …but three within the window still warn.
    trackFlip(s, { k: 4 }, 'urlTransform', 122_000);
    trackFlip(s, { k: 5 }, 'urlTransform', 123_000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
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
});
