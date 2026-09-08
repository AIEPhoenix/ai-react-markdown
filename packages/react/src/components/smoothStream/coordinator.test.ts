/**
 * SmoothCoordinator state machine. The contract under test is the release
 * predicate ("every registered predecessor is done") plus the lifecycle
 * guarantees that keep it deadlock-free: sticky done, unmount-releases,
 * refcount-deferred reclaim (Strict Mode), and version/fanout coalescing.
 */
import { describe, expect, test, vi } from 'vitest';
import { createSmoothCoordinator, evaluateGateWarn } from './coordinator';

const microtasks = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));

describe('createSmoothCoordinator', () => {
  test('registration order gates successors; done releases them in sequence', () => {
    const c = createSmoothCoordinator();
    c.register('a');
    c.register('b');
    c.register('c');
    expect(c.isReleased('a')).toBe(true);
    expect(c.isReleased('b')).toBe(false);
    expect(c.isReleased('c')).toBe(false);

    c.markDone('a');
    expect(c.isReleased('b')).toBe(true);
    expect(c.isReleased('c')).toBe(false); // b is not done yet

    c.markDone('b');
    expect(c.isReleased('c')).toBe(true);
  });

  test('an unregistered chunk queues after everyone and never blocks anyone', () => {
    const c = createSmoothCoordinator();
    c.register('a');
    // 'x' never registered: a pre-registration query treats it as sitting
    // after every registered chunk (releasing early would break ordering),
    // and it never appears in anyone's blocker chain.
    expect(c.isReleased('x')).toBe(false);
    expect(c.earliestBlockerOf('x')).toBe('a');
    c.markDone('a');
    expect(c.isReleased('x')).toBe(true);
    c.register('b');
    expect(c.earliestBlockerOf('b')).toBe(null); // 'x' is not a blocker
  });

  test('done is sticky and idempotent — repeat reports do not bump version', () => {
    const c = createSmoothCoordinator();
    c.register('a');
    c.markDone('a');
    const v = c.version;
    c.markDone('a');
    c.markDone('a');
    expect(c.version).toBe(v);
    expect(c.done.has('a')).toBe(true);
  });

  test('unmount removes the chunk from the order and releases successors', async () => {
    const c = createSmoothCoordinator();
    c.register('a');
    c.register('b');
    expect(c.isReleased('b')).toBe(false);
    c.release('a');
    await microtasks();
    expect(c.order).toEqual(['b']);
    expect(c.isReleased('b')).toBe(true);
    expect(c.done.has('a')).toBe(false);
    expect(c.lastProgressAt.has('a')).toBe(false);
  });

  test('Strict Mode register/release/register keeps the slot (deferred reclaim)', async () => {
    const c = createSmoothCoordinator();
    c.register('a');
    c.release('a');
    c.register('a'); // replayed effect revives before the reclaim microtask
    await microtasks();
    expect(c.order).toEqual(['a']);
    c.register('b');
    expect(c.isReleased('b')).toBe(false); // 'a' still gates
  });

  test('subscriber fanout coalesces a mutation batch into one wake-up', async () => {
    const c = createSmoothCoordinator();
    const wake = vi.fn();
    c.subscribe(wake);
    c.register('a');
    c.register('b');
    c.markDone('a');
    expect(wake).not.toHaveBeenCalled(); // nothing synchronous
    await microtasks();
    expect(wake).toHaveBeenCalledTimes(1);
    expect(c.version).toBe(3); // but every mutation still bumped the version
  });

  test('stampProgress neither bumps the version nor wakes subscribers', async () => {
    const c = createSmoothCoordinator();
    c.register('a');
    await microtasks();
    const wake = vi.fn();
    c.subscribe(wake);
    const v = c.version;
    c.stampProgress('a', 123);
    c.stampProgress('a', 456);
    await microtasks();
    expect(c.version).toBe(v);
    expect(wake).not.toHaveBeenCalled();
    expect(c.lastProgressAt.get('a')).toBe(456);
  });

  test('earliestBlockerOf finds the first not-done predecessor only', () => {
    const c = createSmoothCoordinator();
    c.register('a');
    c.register('b');
    c.register('c');
    c.markDone('a');
    expect(c.earliestBlockerOf('c')).toBe('b');
    expect(c.earliestBlockerOf('b')).toBe(null); // a is done
    expect(c.earliestBlockerOf('a')).toBe(null); // nothing before it
  });

  test('evaluateGateWarn: warn on stale blocker, rearm on progress, clear when unblocked', () => {
    const c = createSmoothCoordinator();
    c.register('a');
    c.register('b');

    // Fresh progress within the threshold → slow model, keep quiet.
    c.stampProgress('a', 9_500);
    expect(evaluateGateWarn(c, 'b', 10_000, 10_000)).toBe('rearm');

    // A full threshold with no reveal progress → stuck flag, warn.
    expect(evaluateGateWarn(c, 'b', 19_500, 10_000)).toBe('warn');

    // A blocker that never stamped at all counts as stale from t=0.
    c.register('x');
    c.markDone('a');
    expect(evaluateGateWarn(c, 'x', 10_000, 10_000)).toBe('warn');
    expect(evaluateGateWarn(c, 'x', 9_999, 10_000)).toBe('rearm');

    // No not-done predecessor left → release is propagating, stop.
    c.markDone('b');
    expect(evaluateGateWarn(c, 'x', 99_999, 10_000)).toBe('clear');
  });

  test('onEmpty fires once when the last chunk leaves, not on Strict Mode churn', async () => {
    const onEmpty = vi.fn();
    const c = createSmoothCoordinator(onEmpty);
    c.register('a');
    c.release('a');
    c.register('a');
    await microtasks();
    expect(onEmpty).not.toHaveBeenCalled();
    c.release('a');
    await microtasks();
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(c.order).toEqual([]);
  });
});
