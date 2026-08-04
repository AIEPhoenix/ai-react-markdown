/**
 * Controller contract: pacing math on an injected clock/scheduler (never
 * the wall clock), grapheme integrity across chunk seams, and the
 * update/finish/snap state machine — including finish() re-entrancy for
 * multi-round LLM flows.
 */
import { describe, expect, test } from 'vitest';
import { createSmoothStreamController, type SmoothStreamOptions } from './controller';

/**
 * Manual clock + frame QUEUE: advance(ms) moves time then runs ONE frame.
 * A queue (not a single slot) so a double-schedule bug shows up as
 * `frameCount() > 1` instead of silently overwriting itself.
 */
const makeHarness = (options: SmoothStreamOptions = {}) => {
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
  const advance = (ms: number) => {
    t += ms;
    frames.shift()?.();
  };
  return { controller, advance, hasFrame: () => frames.length > 0, frameCount: () => frames.length };
};

describe('smoothStream controller', () => {
  test('first update snaps — no animation from empty on mount/remount', () => {
    const { controller, hasFrame } = makeHarness();
    controller.update('Hello **world**, already streamed.');
    expect(controller.getVisible()).toBe('Hello **world**, already streamed.');
    expect(controller.isDrained()).toBe(true);
    expect(hasFrame()).toBe(false);
  });

  test('append-extension animates at the base rate', () => {
    const { controller, advance } = makeHarness({ charsPerSecond: 10, catchUpWindowMs: 100_000 });
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
    const { controller, advance } = makeHarness({ charsPerSecond: 10 });
    controller.update('abc');
    controller.update('abcdef');
    advance(100);
    controller.update('rewritten');
    expect(controller.getVisible()).toBe('rewritten');
    expect(controller.isDrained()).toBe(true);
  });

  test('catch-up: backlog drains within roughly the window', () => {
    const { controller, advance } = makeHarness({ charsPerSecond: 10, catchUpWindowMs: 500 });
    controller.update('');
    controller.update('x'.repeat(1_001));
    // 1000 confirmed graphemes (last held back): proportional rate starts
    // at 1000/0.5s = 2000/s ≫ base and decays exponentially with the
    // backlog (~3.2%/frame). After 160 frames (2.56s) the backlog is down
    // to a handful; base-rate-only pacing would have revealed ~26 chars.
    for (let i = 0; i < 160; i += 1) advance(16);
    expect(controller.getVisible().length).toBeGreaterThanOrEqual(900);
    // The base-rate floor finishes the asymptotic tail (no Zeno stall).
    controller.finish();
    for (let i = 0; i < 200; i += 1) advance(16);
    expect(controller.getVisible().length).toBe(1_001);
  });

  test('finish() confirms the trailing grapheme and drains within drainMs', () => {
    const { controller, advance } = makeHarness({ charsPerSecond: 1, drainMs: 200 });
    controller.update('');
    controller.update('abcdefghij');
    controller.finish();
    // 10 pending / 0.2s window = 50/s: 5 frames of 50ms clear it. The
    // base rate alone (1/s) would take 10 seconds.
    for (let i = 0; i < 5; i += 1) advance(50);
    expect(controller.getVisible()).toBe('abcdefghij');
  });

  test('finish() is re-enterable: a later update resumes animation', () => {
    const { controller, advance } = makeHarness({ charsPerSecond: 10, catchUpWindowMs: 100_000 });
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
    const { controller, advance } = makeHarness({ charsPerSecond: 1_000 });
    controller.update('');
    controller.update(`a${emoji[0]}`);
    advance(1_000);
    // The dangling high surrogate is the (unconfirmed) trailing grapheme.
    expect(controller.getVisible()).toBe('a');
    controller.update(`a${emoji}b`);
    controller.finish();
    advance(1_000);
    expect(controller.getVisible()).toBe(`a${emoji}b`);
  });

  test('ZWJ emoji sequence reveals atomically', () => {
    const family = '👨‍👩‍👧‍👦';
    const { controller, advance } = makeHarness({ charsPerSecond: 10, catchUpWindowMs: 100_000 });
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

  test('flush reveals everything pending, including the tentative tail', () => {
    const { controller } = makeHarness({ charsPerSecond: 1 });
    controller.update('');
    controller.update('abcdef');
    controller.flush();
    expect(controller.getVisible()).toBe('abcdef');
    expect(controller.isDrained()).toBe(true);
  });

  test('banked credit does not dump the next chunk instantly', () => {
    const { controller, advance } = makeHarness({ charsPerSecond: 10, catchUpWindowMs: 100_000 });
    controller.update('');
    controller.update('abc');
    // Drain the confirmed backlog (a, b — c is tentative), then idle.
    advance(1_000);
    expect(controller.getVisible()).toBe('ab');
    // New chunk after an idle spell: the reveal must restart at the base
    // rate, not burn accumulated idle time as credit.
    controller.update('abcdefghijkl');
    advance(16);
    expect(controller.getVisible().length).toBeLessThanOrEqual(3);
  });

  test('getVisible returns a reference-stable snapshot between changes', () => {
    const { controller, advance } = makeHarness({ charsPerSecond: 10 });
    controller.update('abc');
    const before = controller.getVisible();
    advance(5);
    expect(controller.getVisible()).toBe(before);
  });

  test('dispose cancels the scheduled frame and stops notifications', () => {
    const { controller, advance, hasFrame } = makeHarness({ charsPerSecond: 10 });
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
    const { controller, advance, hasFrame } = makeHarness({ charsPerSecond: 10, catchUpWindowMs: 100_000 });
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
    const { controller, advance, hasFrame } = makeHarness({ charsPerSecond: 1, drainMs: 200 });
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
    const { controller, advance, hasFrame } = makeHarness({ charsPerSecond: 10 });
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
    const { controller, advance, frameCount } = makeHarness({ charsPerSecond: 1_000, catchUpWindowMs: 100_000 });
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
    // Low rate on purpose: the first tick reveals PART of the backlog, so
    // when the subscriber disposes, pending is still nonempty — the tick
    // tail must be stopped by the `!disposed` guard itself, not by an
    // incidentally empty queue.
    const { controller, advance, frameCount } = makeHarness({ charsPerSecond: 1_000, catchUpWindowMs: 100_000 });
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
    const { controller, advance, hasFrame } = makeHarness({ charsPerSecond: 1_000 });
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
    const { controller, advance } = makeHarness({ charsPerSecond: 200, catchUpWindowMs: 300 });
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
    for (let i = 0; i < 100; i += 1) advance(16);
    expect(controller.getVisible()).toBe(payload);
  });
});
