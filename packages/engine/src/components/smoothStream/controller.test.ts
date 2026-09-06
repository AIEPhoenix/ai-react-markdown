/**
 * Controller contract on an injected clock/scheduler (never the wall
 * clock): the update/finish/snap state machine (incl. StrictMode replay
 * revival), grapheme integrity across chunk seams, and the pacing law —
 * since v2.10 a completion-deadline law over a gap-quantile window (the
 * dedicated pins live in the "deadline law" describe; the older
 * adaptive-law tests are kept as behavior bands the new law also clears).
 *
 * Determinism recipe for mechanics tests: `minCharsPerSecond` high plus
 * `correctionTauMs` huge pins the reveal to a constant rate. The floor
 * dominates BOTH regimes — pre-stats trivially (huge tau), and the
 * deadline regime because these tests' backlogs over their horizons never
 * demand more than the floor. (A third update DOES record a gap sample
 * and enter the deadline regime — determinism comes from floor dominance,
 * not from staying in pre-stats.) Law tests instead feed timed arrival
 * patterns and assert windowed-rate bands on both axes (too slow AND too
 * fast).
 */
import { describe, expect, test } from 'vitest';
import { createSmoothStreamController, type SmoothStreamOptions } from './controller';
import { testEnv } from '../incrementalParse/spliceArbiterHarness';

/**
 * Manual clock + frame QUEUE: advance(ms) moves time then runs ONE frame.
 * A queue (not a single slot) so a double-schedule bug shows up as
 * `frameCount() > 1` instead of silently overwriting itself. The options
 * object is exposed so tests can retune fields live (the hook's channel).
 */
const makeHarness = (options: SmoothStreamOptions = {}) => {
  let t = 0;
  const frames: Array<() => void> = [];
  const opts: SmoothStreamOptions = {
    now: () => t,
    schedule: (cb) => {
      frames.push(cb);
      return () => {
        const index = frames.indexOf(cb);
        if (index !== -1) frames.splice(index, 1);
      };
    },
    ...options,
  };
  const controller = createSmoothStreamController(opts);
  const advance = (ms: number) => {
    t += ms;
    frames.shift()?.();
  };
  return { controller, advance, hasFrame: () => frames.length > 0, frameCount: () => frames.length, opts };
};

/** Constant-rate mechanics options: floor dominates, feedback negligible. */
const fixedRate = (charsPerSecond: number): SmoothStreamOptions => ({
  minCharsPerSecond: charsPerSecond,
  correctionTauMs: 100_000,
});

describe('smoothStream controller — mechanics', () => {
  test('first update snaps — no animation from empty on mount/remount', () => {
    const { controller, hasFrame } = makeHarness();
    controller.update('Hello **world**, already streamed.');
    expect(controller.getVisible()).toBe('Hello **world**, already streamed.');
    expect(controller.isDrained()).toBe(true);
    expect(hasFrame()).toBe(false);
  });

  test('append-extension animates at the floor rate', () => {
    const { controller, advance } = makeHarness(fixedRate(10));
    controller.update('ab');
    controller.update('abcdefgh');
    expect(controller.getVisible()).toBe('ab');
    // 10 chars/s → 1 grapheme per 100ms. Trailing 'h' is held back
    // (unconfirmed) so only c..g are pending.
    advance(100);
    expect(controller.getVisible()).toBe('abc');
    advance(200);
    expect(controller.getVisible()).toBe('abcde');
    advance(1_000);
    expect(controller.getVisible()).toBe('abcdefg');
    expect(controller.isDrained()).toBe(false);
    controller.finish();
    advance(1_000);
    expect(controller.getVisible()).toBe('abcdefgh');
    expect(controller.isDrained()).toBe(true);
  });

  test('identical update is a no-op (StrictMode replay safety)', () => {
    const { controller } = makeHarness();
    controller.update('abc');
    let notified = 0;
    controller.subscribe(() => {
      notified += 1;
    });
    controller.update('abc');
    expect(notified).toBe(0);
  });

  test('non-append update snaps (content replacement is not a stream)', () => {
    const { controller, advance } = makeHarness(fixedRate(10));
    controller.update('abc');
    controller.update('abcdef');
    advance(100);
    controller.update('rewritten');
    expect(controller.getVisible()).toBe('rewritten');
    expect(controller.isDrained()).toBe(true);
  });

  test('finish() confirms the trailing grapheme and drains within drainMs', () => {
    const { controller, advance } = makeHarness({ ...fixedRate(1), drainMs: 200 });
    controller.update('');
    controller.update('abcdefghij');
    controller.finish();
    // 10 pending, deadline in 200ms: remaining/remaining-time clears it in
    // a few frames. The floor alone (1/s) would take 10 seconds.
    for (let i = 0; i < 5; i += 1) advance(50);
    expect(controller.getVisible()).toBe('abcdefghij');
  });

  test('finish() is re-enterable: a later update resumes animation', () => {
    const { controller, advance } = makeHarness(fixedRate(10));
    controller.update('round one.');
    controller.finish();
    advance(2_000);
    expect(controller.getVisible()).toBe('round one.');
    controller.update('round one. round two!');
    expect(controller.isDrained()).toBe(false);
    advance(100);
    expect(controller.getVisible().length).toBeGreaterThan('round one.'.length);
    controller.finish();
    advance(5_000);
    expect(controller.getVisible()).toBe('round one. round two!');
  });

  test('surrogate pair split across updates is never revealed as a half', () => {
    const emoji = '😀'; // U+1F600, two UTF-16 units
    const { controller, advance } = makeHarness(fixedRate(1_000));
    controller.update('');
    controller.update(`a${emoji[0]}`);
    advance(1_000);
    // Ending mid-pair holds TWO clusters: the lone surrogate, and the cluster
    // before it — the completed character may merge with it (GB9 lets any
    // character take a following Extend, and the supplementary plane is full
    // of them). One frame of latency; the next update releases `a`.
    expect(controller.getVisible()).toBe('');
    controller.update(`a${emoji}b`);
    controller.finish();
    advance(1_000);
    expect(controller.getVisible()).toBe(`a${emoji}b`);
  });

  test('2026-08-19 review r2 P2-6: a frame cut inside a surrogate pair never confirms a boundary that later disappears', () => {
    // The module contract says a surrogate half or a growing ZWJ sequence is
    // never revealed mid-cluster. It broke when the frame ended INSIDE a
    // surrogate pair: the lone high surrogate is a cluster of its own, so the
    // cluster before it was confirmed — and the completed pair then merged
    // the two, leaving the revealed prefix inside the merged cluster
    // (`"👩‍👧‍👦x"` cut at 5 revealed `"👩‍"`). The repo's own streaming
    // simulator slices by UTF-16 index, so this is the default path.
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const legalBoundaries = (text: string) => {
      const ends = new Set<number>([0]);
      for (const part of seg.segment(text)) ends.add(part.index + part.segment.length);
      return ends;
    };
    for (const full of [
      '👩‍👧‍👦x',
      'a🇺🇸🇬🇧b',
      '👍🏽👍',
      'a😀b',
      '👨‍👩‍👧‍👦tail',
      '🇺🇸🇬🇧🇫🇷',
      'x👍🏽y👩‍👧z',
      // GB9: ANY character can take a following Extend, and the supplementary
      // plane has plenty — an ASCII base merges with a musical symbol or a
      // variation-selector supplement just the same (oracle review of 2.5.0,
      // which is why the predecessor is no longer screened for non-ASCII).
      'a\u{1D165}b',
      'a\u{E0101}b',
      '1\u{1F3FB}b',
    ]) {
      const ends = legalBoundaries(full);
      const { controller, advance } = makeHarness(fixedRate(1_000));
      controller.update('');
      for (let i = 1; i <= full.length; i++) {
        controller.update(full.slice(0, i));
        advance(1_000);
        const visible = controller.getVisible();
        expect(ends.has(visible.length), `${JSON.stringify(full)} @${i}: ${JSON.stringify(visible)}`).toBe(true);
      }
      controller.finish();
      advance(1_000);
      expect(controller.getVisible()).toBe(full);
    }
  });

  test('2026-08-20 A2: resuming a finished/snapped round never reveals a broken cluster', () => {
    // `finish()`, `snap()` and a finished `flush()` confirm the source's end
    // unconditionally — a finished stream owes the caller every byte. Then the
    // round resumes (tool call, user turn) and the source grows past that
    // offset, which need not be a cluster boundary any more. `hold` cannot
    // help: it never saw the offset. Left context is what breaks — a lone low
    // surrogate, a leading ZWJ, an odd position in a regional-indicator run.
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const legalBoundaries = (text: string) => {
      const ends = new Set<number>([0]);
      for (const part of seg.segment(text)) ends.add(part.index + part.segment.length);
      return ends;
    };
    const corpus = [
      '\u{1F469}\u200D\u{1F467}\u200D\u{1F466}x',
      'a\u{1F1FA}\u{1F1F8}\u{1F1EC}\u{1F1E7}b',
      '\u{1F1FA}\u{1F1F8}\u{1F1EC}\u{1F1E7}\u{1F1EB}\u{1F1F7}',
      '\u{1F1E6}\u{1F1E7}\u{1F1E8}\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1EC}\u{1F1ED}z', // long RI run: parity is the one thing a window cannot recover
      '\u{1F44D}\u{1F3FD}\u{1F44D}',
      '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}tail',
      '\u{1F468}\u200D\u{1F468}\u200D\u{1F466}\u200D\u{1F466}\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F467}end',
      '\u{1F469}\u{1F3FD}\u200D\u{1F692}\u{1F468}\u{1F3FF}\u200D\u{1F33E}q',
      '\u{1F3F3}\uFE0F\u200D\u{1F308}\u{1F3F4}\u200D\u2620\uFE0F!',
      'a\u0301e\u0301\u0302\u0303b',
      'e\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308x',
      '1\uFE0F\u20E3x',
      'a\u{1D165}b',
      'a\u{E0101}b',
      '\uAC01\uAC01',
      '\u0915\u094D\u0937\u093F \u0928\u092E\u0938\u094D\u0924\u0947',
    ];
    const broken: string[] = [];
    for (const mode of ['finish', 'finish-drained', 'snap', 'flush'] as const) {
      for (const full of corpus) {
        const ends = legalBoundaries(full);
        for (let cut = 1; cut < full.length; cut += 1) {
          const { controller, advance } = makeHarness(fixedRate(1_000));
          // The round the resume starts from may have revealed a broken
          // cluster already — the stream said it was done. That prefix is
          // `inherited`; it cannot be taken back, and everything AFTER it
          // still has to land on real boundaries.
          let inherited = -1;
          if (mode === 'snap') {
            controller.snap(full.slice(0, cut));
            inherited = cut;
          } else {
            controller.update('');
            controller.update(full.slice(0, cut));
            controller.finish();
            if (mode === 'flush') controller.flush();
            else if (mode === 'finish-drained') for (let i = 0; i < 40; i += 1) advance(1);
            if (mode !== 'finish') inherited = controller.getVisible().length;
          }
          controller.update(full);
          const seen = new Set<number>();
          for (let i = 0; i < 40; i += 1) {
            advance(1);
            seen.add(controller.getVisible().length);
          }
          controller.finish();
          for (let i = 0; i < 40; i += 1) advance(1);
          for (const n of seen) {
            if (!ends.has(n) && n !== inherited) {
              broken.push(`${mode} ${JSON.stringify(full)} cut=${cut}: visible.length=${n}`);
            }
          }
          if (controller.getVisible() !== full)
            broken.push(`${mode} ${JSON.stringify(full)} cut=${cut}: never converged`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test('ZWJ emoji sequence reveals atomically', () => {
    const family = '👨‍👩‍👧‍👦';
    const { controller, advance } = makeHarness(fixedRate(10));
    controller.update('');
    controller.update(`${family}tail`);
    const seen = new Set<string>();
    controller.subscribe(() => seen.add(controller.getVisible()));
    for (let i = 0; i < 40; i += 1) advance(100);
    for (const snapshot of seen) {
      if (snapshot.length > 0 && snapshot.length < family.length) {
        throw new Error(`revealed a partial ZWJ sequence: ${JSON.stringify(snapshot)}`);
      }
    }
  });

  test('flush reveals everything CONFIRMED; the tentative tail grapheme waits for finish()', () => {
    // Mid-stream the trailing grapheme is unconfirmed (more text could
    // extend the cluster) — the animation never shows it, and neither may
    // a skip (eng-stream-04). finish() confirms it.
    const { controller } = makeHarness(fixedRate(1));
    controller.update('');
    controller.update('abcdef');
    controller.flush();
    expect(controller.getVisible()).toBe('abcde');
    expect(controller.isDrained()).toBe(false);
    controller.finish();
    controller.flush();
    expect(controller.getVisible()).toBe('abcdef');
    expect(controller.isDrained()).toBe(true);
  });

  test('flush never exposes a surrogate half or a growing ZWJ sequence', () => {
    const { controller } = makeHarness(fixedRate(1));
    controller.update('');
    controller.update('ab\uD83D'); // lone high surrogate at the tail
    controller.flush();
    // `b` is held with the lone surrogate: the completed character could
    // merge with it (see resegmentTail).
    expect(controller.getVisible()).toBe('a');
    controller.update('ab\uD83D\uDE00\u200D'); // 😀 + ZWJ (sequence still growing)
    controller.flush();
    expect(controller.getVisible()).toBe('ab'); // 😀‍ is one growing cluster → held
    controller.update('ab\uD83D\uDE00\u200D\uD83D\uDD25 x'); // 😀‍🔥 then " x"
    controller.flush();
    expect(controller.getVisible()).toBe('ab\uD83D\uDE00\u200D\uD83D\uDD25 '); // "x" is the new tentative tail
    controller.finish();
    controller.flush();
    expect(controller.getVisible()).toBe('ab\uD83D\uDE00\u200D\uD83D\uDD25 x');
  });

  test('banked credit does not dump the next chunk instantly', () => {
    // Recipe margin note: the second append records one gap sample, so
    // the deadline regime is live — but its demanded rate (a few chars
    // over a ~1s horizon) stays below the floor, which keeps dominating
    // every tick. Keep any edits to these numbers on that side.
    const { controller, advance } = makeHarness(fixedRate(10));
    controller.update('');
    controller.update('abc');
    // Drain the confirmed backlog (a, b — c is tentative), then idle.
    advance(1_000);
    expect(controller.getVisible()).toBe('ab');
    // New chunk after an idle spell: the reveal must restart at the floor
    // rate, not burn accumulated idle time as credit.
    controller.update('abcdefghijkl');
    advance(16);
    expect(controller.getVisible().length).toBeLessThanOrEqual(3);
  });

  test('getVisible returns a reference-stable snapshot between changes', () => {
    const { controller, advance } = makeHarness(fixedRate(10));
    controller.update('abc');
    const before = controller.getVisible();
    advance(5);
    expect(controller.getVisible()).toBe(before);
  });

  test('dispose cancels the scheduled frame and stops notifications', () => {
    const { controller, advance, hasFrame } = makeHarness(fixedRate(10));
    controller.update('');
    controller.update('abcdef');
    expect(hasFrame()).toBe(true);
    let notified = 0;
    controller.subscribe(() => {
      notified += 1;
    });
    controller.dispose();
    expect(hasFrame()).toBe(false);
    advance(1_000);
    expect(notified).toBe(0);
  });

  test('StrictMode effect replay: dispose → same-props reuse revives a mid-animation backlog', () => {
    // The dev-only replay disposes the state-held controller, then re-runs
    // the effects with UNCHANGED props: update() hits its identical-string
    // early-return, so revival must reschedule the backlog by itself.
    const { controller, advance, hasFrame } = makeHarness(fixedRate(10));
    controller.update('');
    controller.update('abcdefgh');
    advance(100);
    expect(controller.getVisible()).toBe('a');
    controller.dispose();
    expect(hasFrame()).toBe(false);
    // Replay: reaction effect re-runs with the same content, uSES resubscribes.
    controller.update('abcdefgh');
    const seen: string[] = [];
    controller.subscribe(() => seen.push(controller.getVisible()));
    expect(hasFrame()).toBe(true);
    for (let i = 0; i < 10; i += 1) advance(100);
    controller.finish();
    for (let i = 0; i < 5; i += 1) advance(100);
    expect(controller.getVisible()).toBe('abcdefgh');
    expect(seen.length).toBeGreaterThan(0);
  });

  test('StrictMode effect replay during the post-finish drain also revives', () => {
    const { controller, advance, hasFrame } = makeHarness({ ...fixedRate(1), drainMs: 200 });
    controller.update('');
    controller.update('abcdefghij');
    controller.finish();
    advance(50);
    const midDrain = controller.getVisible();
    expect(midDrain.length).toBeLessThan(10);
    controller.dispose();
    // Replay with unchanged props: update() early-returns, finish() sees
    // finished === true and early-returns — revival alone must reschedule.
    controller.update('abcdefghij');
    controller.finish();
    expect(hasFrame()).toBe(true);
    for (let i = 0; i < 10; i += 1) advance(50);
    expect(controller.getVisible()).toBe('abcdefghij');
  });

  test('subscribe alone revives a disposed controller with backlog', () => {
    const { controller, advance, hasFrame } = makeHarness(fixedRate(10));
    controller.update('');
    controller.update('abcdef');
    controller.dispose();
    expect(hasFrame()).toBe(false);
    controller.subscribe(() => {});
    expect(hasFrame()).toBe(true);
    controller.finish();
    for (let i = 0; i < 20; i += 1) advance(100);
    expect(controller.getVisible()).toBe('abcdef');
  });

  test('reentrant update inside notify does not fork the tick chain', () => {
    const { controller, advance, frameCount } = makeHarness(fixedRate(1_000));
    controller.update('');
    controller.update('abc');
    let grew = false;
    controller.subscribe(() => {
      if (!grew) {
        grew = true;
        controller.update('abcdefgh');
      }
    });
    advance(1_000);
    // ensureScheduled (inside the reentrant update) booked the next frame;
    // tick's own reschedule must yield instead of booking a second chain.
    expect(frameCount()).toBeLessThanOrEqual(1);
    controller.finish();
    for (let i = 0; i < 10; i += 1) {
      advance(100);
      expect(frameCount()).toBeLessThanOrEqual(1);
    }
    expect(controller.getVisible()).toBe('abcdefgh');
  });

  test('reentrant dispose inside notify schedules nothing past disposal', () => {
    // Low advance on purpose: the first tick reveals PART of the backlog,
    // so when the subscriber disposes, pending is still nonempty — the
    // tick tail must be stopped by the `!disposed` guard itself, not by
    // an incidentally empty queue.
    const { controller, advance, frameCount } = makeHarness(fixedRate(1_000));
    controller.update('');
    controller.update('abcdefgh');
    controller.subscribe(() => controller.dispose());
    advance(2);
    expect(controller.getVisible().length).toBeLessThan(7);
    expect(frameCount()).toBe(0);
  });

  test('a single-grapheme append emits no notify until finish', () => {
    // The mechanism behind the hook's arm-on-backlog-formation rule: the
    // appended grapheme is tentative (held back), pending stays empty, so
    // nothing ticks and nothing notifies — the round's ONLY notify is the
    // post-finish drain. Arming off that first notify would be too late.
    const { controller, advance, hasFrame } = makeHarness(fixedRate(1_000));
    controller.update('round one.');
    let notifies = 0;
    controller.subscribe(() => {
      notifies += 1;
    });
    controller.update('round one.。');
    expect(hasFrame()).toBe(false);
    advance(1_000);
    expect(notifies).toBe(0);
    expect(controller.isDrained()).toBe(false);
    controller.finish();
    advance(1_000);
    expect(notifies).toBe(1);
    expect(controller.getVisible()).toBe('round one.。');
  });

  test('visible is always a prefix of the source across a chunked run', () => {
    const payload = '# Title\n\nSome **bold** text with 中文和 emoji 🎉 mixed in.\n\n- item one\n- item two\n';
    const { controller, advance } = makeHarness();
    controller.update('');
    let fed = '';
    const chunks = payload.match(/.{1,7}/gs) ?? [];
    for (const chunk of chunks) {
      fed += chunk;
      controller.update(fed);
      advance(16);
      expect(fed.startsWith(controller.getVisible())).toBe(true);
    }
    controller.finish();
    for (let i = 0; i < 200; i += 1) advance(16);
    expect(controller.getVisible()).toBe(payload);
  });
});

describe('smoothStream controller — adaptive law', () => {
  /**
   * Feeds `burst` chars every `intervalMs` for `bursts` rounds, running a
   * frame per `frameMs`. Returns the final lag (chars) and the largest
   * frame-gap (ms) between visible-length growth events in the LAST HALF
   * of the run (the settled regime).
   */
  const runPattern = (
    harness: ReturnType<typeof makeHarness>,
    { burst, intervalMs, bursts, frameMs = 16 }: { burst: number; intervalMs: number; bursts: number; frameMs?: number }
  ) => {
    const { controller, advance } = harness;
    controller.update('');
    let fed = '';
    let lastGrowthAt = 0;
    let clock = 0;
    let maxSettledStallMs = 0;
    let lastVisibleLength = 0;
    const settleAfter = (bursts * intervalMs) / 2;
    const framesPerInterval = Math.floor(intervalMs / frameMs);
    for (let round = 0; round < bursts; round += 1) {
      fed += 'x'.repeat(burst);
      controller.update(fed);
      for (let f = 0; f < framesPerInterval; f += 1) {
        advance(frameMs);
        clock += frameMs;
        const length = controller.getVisible().length;
        if (length > lastVisibleLength) {
          if (clock > settleAfter) {
            maxSettledStallMs = Math.max(maxSettledStallMs, clock - lastGrowthAt);
          }
          lastGrowthAt = clock;
          lastVisibleLength = length;
        }
      }
    }
    return { lag: fed.length - controller.getVisible().length, maxSettledStallMs, fedLength: fed.length };
  };

  test('fast stream: lag converges to ~one burst instead of a fixed window', () => {
    // 50 chars / 100ms = 500 chars/s. Horizon (balanced) ≈ one interval
    // + pad ≈ 150ms → sawtooth lag well under one burst by each interval's
    // end. The upper bound is deliberately tight: the old fixed 600ms
    // catch-up window held ~300 here and must FAIL this band.
    const harness = makeHarness({ pacing: 'balanced' });
    const { lag } = runPattern(harness, { burst: 50, intervalMs: 100, bursts: 40 });
    expect(lag).toBeGreaterThanOrEqual(10);
    expect(lag).toBeLessThanOrEqual(80);
  });

  test('mid-stream stall then resume: no crawl, no lag balloon, no whoosh', () => {
    // A 30s stall must not poison pacing. The stall gap DOES enter the
    // gap window (there is no pause classifier since v2.10), but it lands
    // in the right tail where the interval quantile ignores it — and even
    // where it briefly IS the quantile, maxLagMs caps the horizon. The
    // resume must neither crawl nor balloon its lag nor whoosh.
    const harness = makeHarness({ pacing: 'balanced' });
    const { controller, advance } = harness;
    controller.update('');
    let fed = '';
    for (let round = 0; round < 20; round += 1) {
      fed += 'x'.repeat(30);
      controller.update(fed);
      for (let f = 0; f < 6; f += 1) advance(16);
    }
    // Stall: half a minute of frames with no arrivals (backlog drains, idles).
    for (let i = 0; i < 120; i += 1) advance(250);
    // Resume at the same cadence; track worst lag and worst stall.
    let maxLag = 0;
    let maxStallMs = 0;
    let lastGrowthClock = 0;
    let clock = 0;
    let lastLength = controller.getVisible().length;
    for (let round = 0; round < 30; round += 1) {
      fed += 'x'.repeat(30);
      controller.update(fed);
      for (let f = 0; f < 6; f += 1) {
        advance(16);
        clock += 16;
        const length = controller.getVisible().length;
        if (length > lastLength) {
          lastLength = length;
          lastGrowthClock = clock;
        } else if (clock > 600) {
          maxStallMs = Math.max(maxStallMs, clock - lastGrowthClock);
        }
        if (clock > 600) maxLag = Math.max(maxLag, fed.length - length);
      }
    }
    // Poisoned estimates produce maxLag ≈ 300+ (1.2s cap at recovering R̂)
    // and floor-crawl stalls; healthy resume stays near one burst.
    expect(maxLag).toBeLessThanOrEqual(120);
    expect(maxStallMs).toBeLessThanOrEqual(400);
  });

  test('connect-flush seeding: two near-simultaneous appends do not disable smoothing', () => {
    // A socket buffer flushing queued events on connect delivers two big
    // appends ~1ms apart. That 1ms gap must not define the pacing: below
    // 11 samples the interval quantile is the window MAX, so one tiny gap
    // cannot drag the horizon down and turn every later burst into an
    // on-arrival dump (smoothing off for seconds).
    const harness = makeHarness({ pacing: 'balanced' });
    const { controller, advance } = harness;
    controller.update('');
    let fed = 'x'.repeat(200);
    controller.update(fed);
    advance(1);
    fed += 'x'.repeat(200);
    controller.update(fed);
    // Normal cadence follows; smoothing must be ACTIVE (visible lags the
    // source mid-interval instead of dumping each burst instantly).
    let minMidIntervalLag = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 15; round += 1) {
      fed += 'x'.repeat(50);
      controller.update(fed);
      for (let f = 0; f < 6; f += 1) advance(16);
      if (round >= 10) {
        minMidIntervalLag = Math.min(minMidIntervalLag, fed.length - controller.getVisible().length);
      }
    }
    expect(minMidIntervalLag).toBeGreaterThanOrEqual(5);
  });

  test('slow stream: reveal keeps flowing between bursts (no stall-pop rhythm)', () => {
    // 8 chars / 400ms = 20 chars/s. A fixed 40/s floor would outrun the
    // source, run dry each round, and pop on the next burst. The adaptive
    // law tracks the source rate, so settled-regime growth gaps stay well
    // under one burst interval.
    const harness = makeHarness({ pacing: 'smooth' });
    const { lag, maxSettledStallMs } = runPattern(harness, { burst: 8, intervalMs: 400, bursts: 24 });
    expect(maxSettledStallMs).toBeLessThan(400);
    expect(lag).toBeGreaterThanOrEqual(1);
    expect(lag).toBeLessThanOrEqual(40);
  });

  test('preset retunes live: switching to responsive shrinks the lag', () => {
    const harness = makeHarness({ pacing: 'smooth' });
    const settled = runPattern(harness, { burst: 40, intervalMs: 100, bursts: 30 });
    harness.opts.pacing = 'responsive';
    const { controller, advance } = harness;
    let fed = 'x'.repeat(settled.fedLength);
    for (let round = 0; round < 30; round += 1) {
      fed += 'x'.repeat(40);
      controller.update(fed);
      for (let f = 0; f < 6; f += 1) advance(16);
    }
    const lagAfter = fed.length - controller.getVisible().length;
    expect(lagAfter).toBeLessThan(settled.lag);
  });

  test('stall mid-stream: backlog eases out and the reveal idles without finish', () => {
    const harness = makeHarness({ pacing: 'balanced' });
    const { controller, advance, hasFrame } = harness;
    runPattern(harness, { burst: 30, intervalMs: 100, bursts: 20 });
    // Source stalls: no more updates. The backlog drains, then the
    // controller goes idle (no busy frame loop while waiting).
    for (let i = 0; i < 600; i += 1) advance(16);
    expect(hasFrame()).toBe(false);
    // The held-back trailing grapheme is the only thing left unrevealed.
    controller.finish();
    for (let i = 0; i < 30; i += 1) advance(16);
    expect(controller.isDrained()).toBe(true);
  });

  test('NaN in any knob (and a bogus preset) falls back instead of freezing', () => {
    const harness = makeHarness({
      pacing: 'bogus' as never,
      bufferFactor: Number.NaN,
      correctionTauMs: Number.NaN,
      emaTauMs: Number.NaN,
      minCharsPerSecond: Number.NaN,
      drainMs: Number.NaN,
      maxLagMs: Number.NaN,
    });
    const { controller, advance } = harness;
    controller.update('');
    controller.update('abcdefgh');
    for (let i = 0; i < 30; i += 1) advance(100);
    expect(controller.getVisible().length).toBeGreaterThan(0);
    controller.finish();
    for (let i = 0; i < 30; i += 1) advance(100);
    expect(controller.getVisible()).toBe('abcdefgh');
  });

  test('Infinity minCharsPerSecond falls back instead of NaN-poisoning a zero-dt tick', () => {
    const { controller, advance } = makeHarness({ minCharsPerSecond: Number.POSITIVE_INFINITY });
    controller.update('');
    controller.update('abcdef');
    // Two ticks in the same clock quantum: dt = 0, and Infinity × 0 = NaN.
    advance(0);
    for (let i = 0; i < 20; i += 1) advance(100);
    controller.finish();
    for (let i = 0; i < 10; i += 1) advance(100);
    expect(controller.getVisible()).toBe('abcdef');
  });
});

describe('smoothStream controller — deadline law (v2.10 pins)', () => {
  /**
   * The shared harness couples time-advance with frame-run, which suits
   * frame-only tests; the deadline-law pins need arrivals BETWEEN frames
   * (and a finish() landing 1ms after an arrival, the hook's real shape:
   * update + finish in the same commit, no frame in between). This
   * standalone driver owns its clock and frame queue directly.
   */
  const drive = (options: SmoothStreamOptions = {}) => {
    let t = 0;
    const frames: Array<() => void> = [];
    const controller = createSmoothStreamController({
      now: () => t,
      schedule: (cb) => {
        frames.push(cb);
        return () => {
          const index = frames.indexOf(cb);
          if (index !== -1) frames.splice(index, 1);
        };
      },
      ...options,
    });
    return {
      controller,
      setTime: (ms: number) => {
        t = ms;
      },
      runFrame: () => frames.shift()?.(),
      now: () => t,
    };
  };

  interface Sample {
    t: number;
    len: number;
    fedLen: number;
    drained: boolean;
  }

  /** Feeds arrivals + 16ms frames, sampling visible length per frame. */
  const feed = (
    d: ReturnType<typeof drive>,
    arrivals: Array<{ at: number; chars: number }>,
    untilMs: number,
    finishAt?: number
  ): Sample[] => {
    d.controller.update('');
    let fed = '';
    let ai = 0;
    let finished = false;
    let nextFrameAt = 16;
    const samples: Sample[] = [];
    let clock = 0;
    while (clock < untilMs) {
      const nextArrival = ai < arrivals.length ? arrivals[ai].at : Number.POSITIVE_INFINITY;
      const nextFinish = finishAt !== undefined && !finished ? finishAt : Number.POSITIVE_INFINITY;
      clock = Math.min(nextArrival, nextFinish, nextFrameAt);
      d.setTime(clock);
      if (clock === nextArrival) {
        fed += 'x'.repeat(arrivals[ai].chars);
        ai += 1;
        d.controller.update(fed);
        continue;
      }
      if (clock === nextFinish) {
        finished = true;
        d.controller.finish();
        continue;
      }
      nextFrameAt += 16;
      d.runFrame();
      samples.push({
        t: clock,
        len: d.controller.getVisible().length,
        fedLen: fed.length,
        drained: d.controller.isDrained(),
      });
    }
    return samples;
  };

  const coarseArrivals = (gapMs: number, chars: number, untilMs: number, from = gapMs) => {
    const a: Array<{ at: number; chars: number }> = [];
    for (let t = from; t <= untilMs; t += gapMs) a.push({ at: t, chars });
    return a;
  };
  const fineArrivals = (untilMs: number, from = 25) => {
    const a: Array<{ at: number; chars: number }> = [];
    for (let t = from; t <= untilMs; t += 25) a.push({ at: t, chars: 4 });
    return a;
  };

  /** Longest gap (ms) between visible-growth events within [from, to]. */
  const maxGrowthGap = (samples: Sample[], from: number, to: number) => {
    let last = from;
    let worst = 0;
    let prevLen = -1;
    for (const s of samples) {
      if (s.t < from || s.t > to) continue;
      if (prevLen === -1) prevLen = s.len;
      if (s.len > prevLen) {
        worst = Math.max(worst, s.t - last);
        last = s.t;
        prevLen = s.len;
      }
    }
    return Math.max(worst, to - last);
  };

  /** Largest single-frame reveal within [from, to]. */
  const maxStep = (samples: Sample[], from: number, to: number) => {
    let worst = 0;
    let prevLen: number | undefined;
    for (const s of samples) {
      if (s.t < from || s.t > to) {
        prevLen = s.len;
        continue;
      }
      if (prevLen !== undefined) worst = Math.max(worst, s.len - prevLen);
      prevLen = s.len;
    }
    return worst;
  };

  /** Fewest chars revealed in any sliding 250ms window within [from, to]. */
  const minWindowChars = (samples: Sample[], from: number, to: number) => {
    let min = Number.POSITIVE_INFINITY;
    let lo = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].t < from + 250 || samples[i].t > to) continue;
      while (samples[lo].t < samples[i].t - 250) lo += 1;
      min = Math.min(min, samples[i].len - samples[lo].len);
    }
    return min;
  };

  test('the 1.8s cliff is gone: 2.2s coarse lumps reveal continuously (fails on the water-level law)', () => {
    const d = drive({ pacing: 'balanced' });
    const samples = feed(d, coarseArrivals(2200, 352, 30_000), 30_000);
    // Steady state: the reveal never pauses longer than 250ms — the old
    // law poured each lump in ~180ms and then sat dead for ~2s.
    expect(maxGrowthGap(samples, 6000, 29_000)).toBeLessThanOrEqual(250);
    // And the rate is period-constant, not pour-then-crawl: every sliding
    // 250ms window reveals a healthy share of the 160 chars/s source.
    expect(minWindowChars(samples, 6000, 29_000)).toBeGreaterThanOrEqual(25);
  });

  test('regime adaptation: fine->coarse engages within two coarse lumps; coarse->fine catches up within a second', () => {
    // fine -> coarse
    {
      const d = drive({ pacing: 'balanced' });
      const arrivals = [...fineArrivals(8000), ...coarseArrivals(2500, 400, 30_000, 10_500)];
      const samples = feed(d, arrivals, 30_000);
      // After two coarse lumps (k=2) the reveal is continuous.
      expect(maxGrowthGap(samples, 15_500, 29_000)).toBeLessThanOrEqual(250);
    }
    // coarse -> fine
    {
      const d = drive({ pacing: 'balanced' });
      const arrivals = [...coarseArrivals(2500, 400, 10_000), ...fineArrivals(30_000, 12_525)];
      const samples = feed(d, arrivals, 30_000);
      // One second into the fine phase the lag is back to fine-stream size.
      const late = samples.filter((s) => s.t > 13_525 && s.t < 14_000);
      for (const s of late) expect(s.fedLen - s.len).toBeLessThanOrEqual(30);
    }
  });

  test('horizon pad: alternating 8/88 lump sizes at a steady 300ms cadence never crawl (balanced & smooth)', () => {
    for (const pacing of ['balanced', 'smooth'] as const) {
      const d = drive({ pacing });
      const arrivals: Array<{ at: number; chars: number }> = [];
      let big = false;
      for (let t = 300; t <= 30_000; t += 300) {
        arrivals.push({ at: t, chars: big ? 88 : 8 });
        big = !big;
      }
      const samples = feed(d, arrivals, 30_000);
      // 160 chars/s source: any sliding 250ms window below 10 chars is a
      // sub-quarter-rate crawl. Without the pad the horizon equals the
      // period exactly and frame quantization produces recurring misses.
      expect(minWindowChars(samples, 6000, 29_000)).toBeGreaterThanOrEqual(10);
    }
  });

  test('too-fast axis: pause resume, in-stream switch, and cross-round resume stay under their recorded ceilings', () => {
    // (a) 8s mid-stream pause: resume must not whoosh.
    {
      const d = drive({ pacing: 'balanced' });
      const arrivals = [...coarseArrivals(100, 16, 6000, 100), ...coarseArrivals(100, 16, 22_000, 14_000)];
      const samples = feed(d, arrivals, 22_000);
      expect(maxStep(samples, 14_000, 22_000)).toBeLessThanOrEqual(8);
    }
    // (b) in-stream fine->coarse switch: recorded 114, ceiling 120.
    {
      const d = drive({ pacing: 'balanced' });
      const arrivals = [...fineArrivals(8000), ...coarseArrivals(2500, 400, 20_000, 10_500)];
      const samples = feed(d, arrivals, 20_000);
      expect(maxStep(samples, 1000, 20_000)).toBeLessThanOrEqual(120);
    }
    // (c) cross-round fine->coarse resume: recorded 101, ceiling 110.
    {
      const d = drive({ pacing: 'balanced' });
      const arrivals = [...fineArrivals(11_000), ...coarseArrivals(2200, 352, 26_000, 13_100)];
      const samples = feed(d, arrivals, 26_000, 11_100);
      expect(maxStep(samples, 13_100, 26_000)).toBeLessThanOrEqual(110);
    }
  });

  test('rate-continuity drain: scales for real backlogs, floors at drainMs, and survives the closing-flush shape', () => {
    const drainOf = (arrivals: Array<{ at: number; chars: number }>, finishAt: number) => {
      const d = drive({ pacing: 'balanced' });
      const samples = feed(d, arrivals, finishAt + 2000, finishAt);
      let drainedAt: number | undefined;
      let peakWindow = 0;
      let lo = 0;
      const post = samples.filter((s) => s.t >= finishAt - 250);
      for (let i = 0; i < post.length; i += 1) {
        while (post[lo].t < post[i].t - 250) lo += 1;
        if (post[i].t >= finishAt) peakWindow = Math.max(peakWindow, post[i].len - post[lo].len);
        if (drainedAt === undefined && post[i].t >= finishAt && post[i].drained) drainedAt = post[i].t;
      }
      return { duration: (drainedAt ?? Number.NaN) - finishAt, peakWindow };
    };
    // Coarse stream, finish right after a lump: big backlog stretches the
    // window (was 223ms / 9× source before the redesign).
    {
      const { duration, peakWindow } = drainOf(coarseArrivals(2200, 352, 8810), 8810.5);
      expect(duration).toBeGreaterThanOrEqual(500);
      expect(duration).toBeLessThanOrEqual(3 * 240 + 40);
      // ≤ 3.5× the 160 chars/s throughput, per 250ms window (recorded
      // ~121). Tight enough to kill a DRAIN_CATCHUP_FACTOR=4 mutant
      // (~156, terminal review m-NEW-2) — the fast direction was
      // otherwise only covered by the 3× clamp.
      expect(peakWindow).toBeLessThanOrEqual(140);
    }
    // Closing flush IN THE SAME COMMIT as finish (the hook's real shape):
    // the flush must not inflate its own drain budget.
    {
      const arrivals = [...fineArrivals(9990), { at: 10_010, chars: 600 }];
      const { duration, peakWindow } = drainOf(arrivals, 10_011);
      expect(duration).toBeGreaterThanOrEqual(500);
      expect(duration).toBeLessThanOrEqual(3 * 240 + 40);
      expect(peakWindow).toBeLessThanOrEqual(6 * 40);
    }
    // Tiny tail: identical to the fixed drainMs window of old.
    {
      const { duration } = drainOf(fineArrivals(10_000), 10_012);
      expect(duration).toBeGreaterThanOrEqual(100);
      expect(duration).toBeLessThanOrEqual(240 + 40);
    }
  });

  test('gap-window retention across finish(): a same-cadence resume animates from the FIRST lump', () => {
    // The ablation-sensitive pin: clear the window in finish() and the
    // first resumed lump falls back to pre-stats (a ~180ms pour, then
    // ~2s dead) — this growth-gap assertion then fails. Retention was
    // measured 0% dead on this shape vs 35% for the clearing variant.
    const d = drive({ pacing: 'balanced' });
    const arrivals = [...coarseArrivals(2200, 352, 11_000), ...coarseArrivals(2200, 352, 26_000, 13_100)];
    const samples = feed(d, arrivals, 26_000, 11_100);
    expect(maxGrowthGap(samples, 13_100, 25_000)).toBeLessThanOrEqual(2200 - 1500);
  });

  test('preset lag ordering under a 250ms burst feed: responsive < balanced < smooth', () => {
    const lagOf = (pacing: 'responsive' | 'balanced' | 'smooth') => {
      const d = drive({ pacing });
      const samples = feed(d, coarseArrivals(250, 40, 20_000), 20_000);
      let sum = 0;
      let n = 0;
      for (const s of samples) {
        if (s.t < 6000) continue;
        sum += s.fedLen - s.len;
        n += 1;
      }
      return sum / n;
    };
    const r = lagOf('responsive');
    const b = lagOf('balanced');
    const s = lagOf('smooth');
    // Ratio floors, not bare ordering: a mutant that disconnects
    // bufferFactor from the horizon still "orders" the three lags by
    // ~0.001 chars of pre-stats residue. Real spacing is ~2× per step
    // (recorded 13.3 / 26.6 / 54.6).
    expect(b).toBeGreaterThan(1.5 * r);
    expect(s).toBeGreaterThan(1.5 * b);
  });

  test('maxLagMs override caps the horizon (the field the presets ship)', () => {
    // Default balanced holds ~183 chars of mean lag on a 2.2s coarse feed
    // (its 2500ms cap never binds); overriding maxLagMs to 300 must pull
    // the mean lag under 60 (recorded 24.7). This is the only behavioral
    // coverage of the cap term AND of the per-field override path — a
    // mutant that deletes the cap passes every other pin.
    const meanLag = (options: SmoothStreamOptions) => {
      const d = drive(options);
      const samples = feed(d, coarseArrivals(2200, 352, 20_000), 20_000);
      let sum = 0;
      let n = 0;
      for (const s of samples) {
        if (s.t < 6000) continue;
        sum += s.fedLen - s.len;
        n += 1;
      }
      return sum / n;
    };
    expect(meanLag({ pacing: 'balanced', maxLagMs: 300 })).toBeLessThanOrEqual(60);
    expect(meanLag({ pacing: 'balanced' })).toBeGreaterThan(120);
  });

  test('finish() drops the arrival clock: tool-call pauses never become gap samples', () => {
    // Short rounds are the load-bearing shape: 2 lumps per round, a 6s
    // tool-call pause between rounds. If finish() kept lastArrivalAt,
    // every resume would push a ~6s pause sample into the window; from
    // round 2 the k=2 quantile lands on the pauses, the horizon saturates
    // at maxLagMs, and each round is withheld until its drain (measured:
    // finish→drained 230ms → 710ms; long fine-grained rounds mask this
    // entirely, so this pin must stay short-round).
    const d = drive({ pacing: 'balanced' });
    d.controller.update('');
    let fed = '';
    let nextFrameAt = 16;
    const stepFramesTo = (target: number) => {
      while (nextFrameAt <= target) {
        d.setTime(nextFrameAt);
        d.runFrame();
        nextFrameAt += 16;
      }
    };
    for (let round = 0; round < 3; round += 1) {
      const t0 = round * 6810;
      d.setTime(t0);
      fed += 'x'.repeat(200);
      d.controller.update(fed);
      stepFramesTo(t0 + 800);
      d.setTime(t0 + 800);
      fed += 'x'.repeat(200);
      d.controller.update(fed);
      d.setTime(t0 + 810);
      d.controller.finish();
      let drainedAt: number | undefined;
      while (nextFrameAt <= t0 + 6810) {
        d.setTime(nextFrameAt);
        d.runFrame();
        if (drainedAt === undefined && d.controller.isDrained()) drainedAt = nextFrameAt;
        nextFrameAt += 16;
      }
      expect(drainedAt, `round ${round} never drained`).toBeDefined();
      if (round >= 1) {
        expect((drainedAt ?? Infinity) - (t0 + 810), `round ${round} drain`).toBeLessThanOrEqual(500);
      }
    }
  });

  test('snap() resets the cadence window: a replacement does not inherit coarse pacing', () => {
    const d = drive({ pacing: 'balanced' });
    feed(d, coarseArrivals(2200, 352, 9000), 9000); // builds a coarse gap window
    d.controller.snap('replacement seed');
    const base = 'replacement seed'.length;
    let fed = 'replacement seed';
    d.setTime(9100);
    fed += 'x'.repeat(200);
    d.controller.update(fed);
    d.setTime(9200);
    fed += 'x'.repeat(200);
    d.controller.update(fed);
    for (let t = 9216; t <= 9800; t += 16) {
      d.setTime(t);
      d.runFrame();
    }
    // Fresh window: one 100ms sample → horizon ≈ 150ms → both post-snap
    // lumps are on screen well before 9800. A stale coarse window would
    // keep a ~2.2s horizon and reveal only ~100 chars in this span.
    expect(d.controller.getVisible().length).toBeGreaterThanOrEqual(base + 350);
  });

  const FUZZ_RUNS = Number(testEnv('FUZZ_RUNS') ?? 60);
  const FUZZ_TIMEOUT_MS = Math.max(30_000, FUZZ_RUNS * 30);

  test(
    'invariant fuzz: monotone, bounded, held-back, drains on time, never a giant step',
    { timeout: FUZZ_TIMEOUT_MS },
    () => {
      const runs = FUZZ_RUNS;
      const mkRng = (seed: number) => () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
      };
      const failures: string[] = [];
      for (let seed = 1; seed <= runs; seed += 1) {
        const rng = mkRng(seed * 7919);
        const pacing = (['responsive', 'balanced', 'smooth'] as const)[Math.floor(rng() * 3)];
        const d = drive({ pacing });
        const arrivals: Array<{ at: number; chars: number }> = [];
        let t = 0;
        const dur = 8000 + rng() * 12_000;
        while (t < dur) {
          const mode = rng();
          const gap =
            mode < 0.3
              ? 25
              : mode < 0.55
                ? 250
                : mode < 0.75
                  ? 80 + rng() * 400
                  : mode < 0.92
                    ? 1500 + rng() * 1500
                    : 2000 + rng() * 6000;
          t += gap;
          arrivals.push({ at: t, chars: 1 + Math.floor(rng() * 1000) });
        }
        const maxChunk = arrivals.reduce((worst, a) => Math.max(worst, a.chars), 0);
        // I5 ceiling is CORPUS-RELATIVE, not a law invariant: a single-frame
        // reveal scales linearly with the largest burst chunk (a fine stream
        // hit by one big flush pours it over its small horizon — steady
        // forms measure ≈0.57 × chunk; a 100k-seed sweep of this corpus
        // tops out at 0.83 × ceiling, so the 0.75+40 formula holds there).
        // SCALE LIMIT: safe to ~50k seeds; do NOT run this at the repo's
        // 300k-soak scale — an adversarial corpus shape (quantile pinned
        // at the cap + stacked 25ms big chunks collapsing the horizon on
        // window turnover, ~1-in-400k runs) can legitimately reach ~4 ×
        // the ceiling. A fixed 100 falsely reds healthy code once
        // FUZZ_RUNS grows (seed 313 at the old 200-char corpus cap).
        const stepCeiling = Math.max(100, 0.75 * maxChunk + 40);
        const finishAt = t + 50;
        const samples = feed(d, arrivals, finishAt + 4000, finishAt);
        let prev = 0;
        let drainedAt: number | undefined;
        for (const s of samples) {
          // I1 monotone; I2 never beyond source.
          if (s.len < prev) failures.push(`seed ${seed}: visible shrank`);
          if (s.len > s.fedLen) failures.push(`seed ${seed}: visible beyond source`);
          // I3 ASCII holdback while live.
          if (s.t < finishAt && s.fedLen > 0 && s.len > s.fedLen - 1) failures.push(`seed ${seed}: tail not held`);
          // I5 the too-fast axis (corpus-relative, see stepCeiling above).
          if (s.len - prev > stepCeiling) failures.push(`seed ${seed}: step ${s.len - prev} > ${stepCeiling}`);
          prev = s.len;
          if (drainedAt === undefined && s.t >= finishAt && s.drained) drainedAt = s.t;
        }
        // I4 drains within 3×drainMs (+ frame slack) of finish.
        if (drainedAt === undefined || drainedAt - finishAt > 3 * 320 + 100) {
          failures.push(
            `seed ${seed}: drain overran (${drainedAt === undefined ? 'never' : Math.round(drainedAt - finishAt)}ms)`
          );
        }
        if (failures.length > 5) break;
      }
      expect(failures).toEqual([]);
    }
  );
});

test('large partially consumed backlogs preserve append, flush and replacement behavior', () => {
  const { controller, advance } = makeHarness(fixedRate(1000));
  const source = 'a'.repeat(2400);
  controller.update('');
  controller.update(source);
  for (let i = 0; i < 12; i++) advance(100);
  expect(controller.getVisible()).toBe(source.slice(0, 1200));
  controller.update(source + 'bc');
  controller.flush();
  expect(controller.getVisible()).toBe(source + 'b');
  controller.finish();
  controller.flush();
  expect(controller.getVisible()).toBe(source + 'bc');
  controller.update('replacement');
  controller.update('replacement tail');
  controller.finish();
  controller.flush();
  expect(controller.getVisible()).toBe('replacement tail');
});
