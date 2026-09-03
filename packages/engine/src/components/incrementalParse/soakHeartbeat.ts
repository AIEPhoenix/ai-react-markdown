/**
 * Progress heartbeats for the soak legs.
 *
 * THE PROBLEM. Every leg is one vitest process running one or two tests
 * that take tens of minutes. vitest's progress granularity is the TEST, so
 * a shard log sits at three lines of startup banner for four hours and
 * looks exactly the same whether the run is at 5% or 95% — or wedged. On
 * 2026-09-02 that cost hours of not knowing whether a remote box was
 * making progress, and a misread `ps` on top of it.
 *
 * WHY IT LIVES IN THE TESTS. Only the loop knows its own denominator. A
 * watcher outside the process can time the run and read the file's mtime,
 * but "how far along" is a number no external observer can compute — which
 * is why the previous attempt to solve this by watching the logs harder
 * never produced a percentage.
 *
 * THE TIMESTAMP IS THE POINT. A percentage tells you the run is slow; a
 * timestamp tells you the difference between slow and DEAD, which is the
 * question actually being asked at hour three. `scripts/soak/soak-watch.sh`
 * reads `epoch=` and flags a shard whose last beat has aged out. Treat the
 * percentage as the nice-to-have and the staleness as the feature.
 *
 * OFF BY DEFAULT. `tick()` returns on a boolean when `SOAK_HEARTBEAT` is
 * unset, so CI, `pnpm preflight` and a bare `vitest run` are byte-identical
 * to before. `soak.sh` exports the interval; nothing else does.
 *
 * The line is written to stderr rather than through `console.*` because
 * vitest drops console output from passing tests unless a reporter is
 * named — the same trap the evidence harnesses document — and a heartbeat
 * that only appears on failure is worse than none.
 *
 * COST, measured 2026-09-03 with the mechanism on against off: the latex
 * leg at 6000 runs, 21.03 s -> 21.11 s; the census leg at K=2, 19.44 s ->
 * 19.01 s. Both inside run-to-run noise. A meter that shows up in a profile
 * is a meter someone deletes, so the number is worth having on record
 * rather than asserted from the design.
 */

import { testEnv } from './spliceArbiterHarness';

/** Seconds between beats; unset or 0 disables the mechanism entirely. */
const INTERVAL_MS = Math.max(0, Number(testEnv('SOAK_HEARTBEAT') ?? 0)) * 1000;

const ENABLED = INTERVAL_MS > 0;

const write = (line: string): void => {
  (process as unknown as { stderr?: { write(text: string): void } }).stderr?.write(line);
};

export interface SoakBeat {
  /** Record `units` of work (default 1) and emit a line if the interval has
   *  elapsed. Safe to call in the hottest loop — see the mask below. */
  tick(units?: number): void;
  /** Emit a final line unconditionally, so a finished shard is visibly
   *  finished rather than merely stale. */
  finish(): void;
}

const INERT: SoakBeat = { tick: () => {}, finish: () => {} };

/**
 * A heartbeat for one phase of one leg. `total` is the phase's planned unit
 * count; pass 0 when the loop genuinely cannot know it, and the line prints
 * a count with no percentage rather than a made-up one.
 *
 * The leg and shard are NOT parameters. Both are already in the log's
 * filename (`<label>-<leg>-<shard>.log`), which the watcher parses, and
 * threading a shard index into five test files would have meant five new
 * env vars in the gate script this work is meant to leave alone.
 */
export function soakBeat(phase: string, total: number): SoakBeat {
  if (!ENABLED) return INERT;
  const started = Date.now();
  let done = 0;
  let next = started + INTERVAL_MS;
  return {
    tick(units = 1): void {
      done += units;
      // The clock is only read every 16th call. `Date.now()` is cheap but
      // the census leg's inner loop runs it millions of times, and a
      // progress meter that shows up in a profile is a progress meter
      // someone will delete.
      if ((done & 15) !== 0) return;
      const now = Date.now();
      if (now < next) return;
      next = now + INTERVAL_MS;
      emit(phase, done, total, started, now);
    },
    finish(): void {
      const now = Date.now();
      emit(phase, done, total, started, now, ' final');
    },
  };
}

function emit(phase: string, done: number, total: number, started: number, now: number, suffix = ''): void {
  const pct = total > 0 ? ` pct=${((done / total) * 100).toFixed(1)}` : '';
  const elapsed = Math.round((now - started) / 1000);
  write(
    `[hb] phase=${phase} done=${done}${total > 0 ? `/${total}` : ''}${pct}` +
      ` elapsed=${elapsed}s epoch=${Math.floor(now / 1000)} at=${new Date(now).toISOString()}${suffix}\n`
  );
}
