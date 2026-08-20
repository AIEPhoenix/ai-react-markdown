/**
 * Controller contract on an injected clock/scheduler (never the wall
 * clock): the update/finish/snap state machine (incl. StrictMode replay
 * revival), grapheme integrity across chunk seams, and the ADAPTIVE
 * pacing law — arrival-rate tracking, target-buffer convergence, and the
 * deadline drain.
 *
 * Determinism recipe for mechanics tests: `minCharsPerSecond` high plus
 * `correctionTauMs` huge pins the reveal to a constant rate (the floor
 * dominates both the pre-stats and the adaptive regime), reproducing
 * fixed-rate traces exactly. Law tests instead feed timed arrival
 * patterns and assert convergence bands.
 */
import { describe, expect, test } from 'vitest';
import { createSmoothStreamController, type SmoothStreamOptions } from './controller';

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
    // Recipe margin note: the second append records one arrival sample
    // (zero-prior blended, R̂ ≈ 4 « floor 10), so the floor still
    // dominates every tick. Keep any edits to these numbers on that side.
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
    // 50 chars / 100ms = 500 chars/s. Target buffer (balanced) ≈ one burst
    // = 50 chars ≈ 100ms of lag. The upper bound is deliberately tight:
    // a feedback-only law (feedforward deleted) settles near ~120 here,
    // and the old fixed 600ms window held ~300 — both must FAIL this band.
    const harness = makeHarness({ pacing: 'balanced' });
    const { lag } = runPattern(harness, { burst: 50, intervalMs: 100, bursts: 40 });
    expect(lag).toBeGreaterThanOrEqual(10);
    expect(lag).toBeLessThanOrEqual(80);
  });

  test('mid-stream stall then resume: no crawl, no lag balloon, no whoosh', () => {
    // A 30s stall is a PAUSE, not cadence. Feeding that gap into the EMAs
    // at α≈1 would rewrite R̂≈1/s and Î≈30s in one sample: the resume then
    // crawls at the anti-freeze floor while B* pegs at the 1.2s cap, and
    // finally dumps the excess in a whoosh when Î decays. The epoch guard
    // must discard pause-length gaps instead.
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
    // appends ~1ms apart. An UNBLENDED first sample would seed R̂ at
    // added×1000 chars/s — the reveal then tracks that phantom rate and
    // every later burst dumps on arrival (smoothing off for seconds).
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
