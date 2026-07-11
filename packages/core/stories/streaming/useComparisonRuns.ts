'use client';

/**
 * Shared run controller for the two block-memo comparison stories
 * (`BlockMemoComparison` = same-page, `IsolatedComparison` = cross-site
 * iframes). Owns everything that must behave IDENTICALLY in both variants —
 * config state, payload derivations, the run lifecycle, the deferred
 * history record, the Run ×3 chain and the noise-band inputs — so a fix or
 * tuning change lands in one place and the two stories keep recording
 * comparable histories.
 *
 * The variants differ only in how chunks reach the two sides; that arrives
 * as a transport (`begin`/`push`/`end`/`canStart`) plus a `settleMs` for
 * how long the final snapshots take to land (longer when they cross a
 * process boundary).
 *
 * @module stories/streaming/useComparisonRuns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildScenarios, countBlocks, DEFAULT_PAYLOAD, type ScenarioKey } from './scenarios';
import type { RenderProfilerSnapshot } from './useRenderProfiler';

export const PAYLOAD_SCALES = [1, 4, 16] as const;
export type PayloadScale = (typeof PAYLOAD_SCALES)[number];

/** One completed run, as recorded for the history table and the noise-band
 *  estimate. Sign convention matches the summary banner: positive delta =
 *  block-memo saved time. */
export interface RunRecord {
  at: string;
  scenario: ScenarioKey;
  scale: PayloadScale;
  chars: number;
  blocks: number;
  spy: boolean;
  /** True when both sides ran under an AIMarkdownDocuments registry
   *  (coordinated mode — PASS 0 def-label scan active per token). */
  registry: boolean;
  /** disabled.total − enabled.total (ms); positive = block-memo faster. */
  deltaTotal: number;
  /** disabled.p95 − enabled.p95 (ms); positive = block-memo faster. */
  deltaP95: number;
  /** disabled − enabled element render count; null when spy was off. */
  deltaElem: number | null;
}

export interface UseComparisonRunsOptions {
  /** Base markdown payload (multiplied by the payload scale). */
  payload?: string;
  initialScenario: ScenarioKey;
  /**
   * Run state lives in the CALLER: the profilers take `running` as input
   * and produce the snapshots this hook consumes, so hook-owned state would
   * make the wiring circular (profilers would read last render's value).
   */
  running: boolean;
  setRunning: (running: boolean) => void;
  /**
   * How long after `running` flips false the snapshots need to settle
   * before the run is recorded. The profiler publishes one FINAL snapshot
   * after the last interval tick; the isolated variant additionally waits
   * for it to cross a process boundary.
   */
  settleMs: number;
  /** Live snapshot of the block-memo-enabled side. */
  enabledSnapshot: RenderProfilerSnapshot;
  /** Live snapshot of the legacy side. */
  disabledSnapshot: RenderProfilerSnapshot;
  /** Gate: return false to refuse a start (e.g. iframes not ready yet). */
  canStart?: () => boolean;
  /** Prepare both sides for a fresh run (reset profilers / broadcast start). */
  begin: () => void;
  /** Deliver one chunk to both sides. */
  push: (chunk: string) => void;
  /** Signal end-of-run to both sides. Also invoked by stop(). */
  end?: () => void;
}

export function useComparisonRuns({
  payload,
  initialScenario,
  running,
  setRunning,
  settleMs,
  enabledSnapshot,
  disabledSnapshot,
  canStart,
  begin,
  push,
  end,
}: UseComparisonRunsOptions) {
  const [scenario, setScenario] = useState<ScenarioKey>(initialScenario);
  const [payloadScale, setPayloadScale] = useState<PayloadScale>(1);
  const [spyEnabled, setSpyEnabled] = useState(true);
  const [registryEnabled, setRegistryEnabled] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);

  const cancelRef = useRef<(() => void) | null>(null);
  // Config of the run currently in flight — consumed by the record effect
  // when `running` flips back to false.
  const pendingRunRef = useRef<{
    scenario: ScenarioKey;
    scale: PayloadScale;
    chars: number;
    blocks: number;
    spy: boolean;
    registry: boolean;
  } | null>(null);
  // Remaining auto-repeats for the "Run ×3" button.
  const multiRemainingRef = useRef(0);
  // Run generation. Bumped by every launch, stop and unmount. The deferred
  // record/chain timeouts (which deliberately have no cleanup — they must
  // survive snapshot-driven effect re-runs) capture the generation at arm
  // time and become no-ops once it moves on. One mechanism closes every
  // disarm hole at once: Stop/Reset inside the settle window can't record
  // a zeroed row, a restart inside the window can't attribute the next
  // run's snapshots to the previous config, an armed chain timer can't
  // start a run the user has since stopped, and unmount inerts everything.
  const runGenRef = useRef(0);

  const basePayload = payload || DEFAULT_PAYLOAD;
  const effectivePayload = useMemo(() => basePayload.repeat(payloadScale), [basePayload, payloadScale]);
  const payloadChars = effectivePayload.length;
  const payloadBlocks = useMemo(() => countBlocks(effectivePayload), [effectivePayload]);
  const scenarios = useMemo(() => buildScenarios(effectivePayload), [effectivePayload]);

  const stop = useCallback(() => {
    runGenRef.current += 1; // inert any armed record/chain timers
    multiRemainingRef.current = 0;
    // Disarm the pending record: a manually aborted run must NOT enter the
    // history — its truncated delta would feed sameConfigRuns and poison
    // the 2×stddev noise band every later verdict leans on.
    pendingRunRef.current = null;
    cancelRef.current?.();
    cancelRef.current = null;
    end?.();
    setRunning(false);
  }, [end, setRunning]);

  // Launch a run WITHOUT touching the auto-repeat counter — the shared
  // core of a manual start, "Run ×3" and the chain restart.
  const launch = useCallback(() => {
    if (canStart && !canStart()) return;
    runGenRef.current += 1; // a new run supersedes any armed timers
    cancelRef.current?.();
    begin();
    pendingRunRef.current = {
      scenario,
      scale: payloadScale,
      chars: payloadChars,
      blocks: payloadBlocks,
      spy: spyEnabled,
      registry: registryEnabled,
    };
    setRunning(true);
    cancelRef.current = scenarios[scenario].run(push, () => {
      end?.();
      setRunning(false);
    });
  }, [
    canStart,
    begin,
    push,
    end,
    setRunning,
    scenario,
    scenarios,
    payloadScale,
    payloadChars,
    payloadBlocks,
    spyEnabled,
    registryEnabled,
  ]);

  // Latest `launch` behind a stable ref so the record effect can chain
  // multi-runs without listing it (whose identity changes with config)
  // as a dep and re-firing on config edits.
  const launchRef = useRef(launch);
  useEffect(() => {
    launchRef.current = launch;
  });

  // A manual start is a fresh gesture: drop any leftover auto-repeat debt
  // (a zero-commit run is never recorded, so the chain counter would
  // otherwise survive it and phantom-repeat the NEXT single run). A plain
  // () => void, so stories can pass it directly as an onClick handler.
  const start = useCallback(() => {
    multiRemainingRef.current = 0;
    launch();
  }, [launch]);

  const startMulti = useCallback(() => {
    multiRemainingRef.current = 2; // this run + 2 repeats = 3 total
    launch();
  }, [launch]);

  // Latest snapshots behind refs, for the deferred history record below.
  // Mirrored in an effect (not during render) to satisfy react-hooks/refs;
  // the deferred reader fires ≥settleMs later, long after these commit.
  const enabledSnapRef = useRef(enabledSnapshot);
  const disabledSnapRef = useRef(disabledSnapshot);
  useEffect(() => {
    enabledSnapRef.current = enabledSnapshot;
    disabledSnapRef.current = disabledSnapshot;
  }, [enabledSnapshot, disabledSnapshot]);

  // Record a finished run into history. The profiler publishes one FINAL
  // snapshot when `running` flips false, one render after the last interval
  // tick — so recording synchronously here would capture a snapshot that
  // can still be missing the last ~100 ms of commits. Instead: arm once
  // (pending cleared immediately so re-publishes can't double-record), then
  // read the settled snapshots from refs after the settle delay. No cleanup
  // on purpose — the timeout must survive the snapshot-driven effect
  // re-runs; the generation check keeps it inert once anything (stop,
  // reset, a new launch, unmount) has superseded this run.
  useEffect(() => {
    if (running) return;
    const pending = pendingRunRef.current;
    if (!pending) return;
    // Zero commits means the snapshots have not settled yet — wait for the
    // re-run this effect gets when they land. (A genuinely empty run keeps
    // its pending armed; the next launch overwrites it, and manual starts
    // clear the chain counter, so nothing phantom-fires from it.)
    if (enabledSnapshot.actual.count === 0 || disabledSnapshot.actual.count === 0) return;
    pendingRunRef.current = null;
    const gen = runGenRef.current;
    window.setTimeout(() => {
      if (gen !== runGenRef.current) return; // superseded — discard
      const e = enabledSnapRef.current;
      const d = disabledSnapRef.current;
      const rec: RunRecord = {
        at: new Date().toLocaleTimeString(),
        scenario: pending.scenario,
        scale: pending.scale,
        chars: pending.chars,
        blocks: pending.blocks,
        spy: pending.spy,
        registry: pending.registry,
        deltaTotal: d.actual.total - e.actual.total,
        deltaP95: d.actual.p95 - e.actual.p95,
        deltaElem: pending.spy ? d.elementRenders.total - e.elementRenders.total : null,
      };
      setRuns((prev) => [...prev.slice(-11), rec]);
      if (multiRemainingRef.current > 0) {
        multiRemainingRef.current -= 1;
        window.setTimeout(() => {
          if (gen !== runGenRef.current) return; // superseded — no chain
          launchRef.current();
        }, 400);
      }
    }, settleMs);
  }, [running, enabledSnapshot, disabledSnapshot, settleMs]);

  useEffect(
    () => () => {
      runGenRef.current += 1; // unmount inerts every armed timer
      cancelRef.current?.();
    },
    []
  );

  // `chars` covers every payload-shape change in one comparison: the scale
  // selector AND the base-payload variants (e.g. the defs payload) — runs
  // from a differently-shaped document must never share a noise band.
  const sameConfigRuns = useMemo(
    () =>
      runs.filter(
        (r) =>
          r.scenario === scenario &&
          r.scale === payloadScale &&
          r.chars === payloadChars &&
          r.spy === spyEnabled &&
          r.registry === registryEnabled
      ),
    [runs, scenario, payloadScale, payloadChars, spyEnabled, registryEnabled]
  );

  const clearRuns = useCallback(() => setRuns([]), []);

  return {
    scenario,
    setScenario,
    payloadScale,
    setPayloadScale,
    spyEnabled,
    setSpyEnabled,
    registryEnabled,
    setRegistryEnabled,
    runs,
    clearRuns,
    sameConfigRuns,
    payloadChars,
    payloadBlocks,
    scenarios,
    start,
    startMulti,
    stop,
  };
}
