'use client';

/**
 * Shared run controller for the two block-memo comparison stories
 * (`BlockMemoComparison` = same-page, `IsolatedComparison` = cross-site
 * iframes). Owns everything that must behave IDENTICALLY in both variants —
 * config state (scenario, scale, spy, registry, defs), payload derivation,
 * the run lifecycle, the history record, the Run ×3 chain and the
 * noise-band inputs — so a fix or tuning change lands in one place and the
 * two stories keep recording comparable histories.
 *
 * The variants differ only in how chunks reach the two sides; that arrives
 * as a transport (`begin`/`push`/`end`/`canStart`).
 *
 * Recording is HANDSHAKE-driven, not timer-driven: the profilers mark the
 * one snapshot they publish after `running` flips false as `settled`, and
 * the record effect fires exactly when both sides' settled finals are in.
 * A slow cross-process final simply records later; a snapshot wiped by an
 * external reset (frame remount, theme change) is `settled: false` and can
 * never be mistaken for a finished run. There is no settle delay to guess
 * and no window in which a stale or zeroed snapshot can be recorded.
 *
 * @module stories/streaming/useComparisonRuns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildScenarios, countBlocks, DEFAULT_PAYLOAD, withDefs, type ScenarioKey } from './scenarios';
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
  /** True when the definitions tail was appended to the scaled payload. */
  defs: boolean;
  /** True when the enabled side ran with `incrementalParse` (prefix-freeze parsing). */
  incremental: boolean;
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
  /** Live snapshot of the block-memo-enabled side. */
  enabledSnapshot: RenderProfilerSnapshot;
  /** Live snapshot of the legacy side. */
  disabledSnapshot: RenderProfilerSnapshot;
  /** Gate: return false to refuse a start (e.g. iframes not ready yet). */
  canStart?: () => boolean;
  /**
   * Prepare both sides for a fresh run. MUST leave both snapshots in a
   * non-`settled` state before the run starts (profiler resets do this),
   * so a previous run's settled final can never satisfy the record
   * handshake while this run's snapshots are still in flight.
   */
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
  const [defsEnabled, setDefsEnabled] = useState(false);
  const [incrementalEnabled, setIncrementalEnabled] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // True from Run ×3 until its last repeat records (or anything cancels
  // the chain). Exposed via `busy` so stories disable config controls for
  // the WHOLE batch — a config edit in the inter-run gap would otherwise
  // silently split the "same config ×3" promise across two configs.
  const [chainPending, setChainPending] = useState(false);

  const cancelRef = useRef<(() => void) | null>(null);
  // Config of the run currently in flight — consumed by the record effect
  // when both settled finals arrive.
  const pendingRunRef = useRef<{
    scenario: ScenarioKey;
    scale: PayloadScale;
    chars: number;
    blocks: number;
    spy: boolean;
    registry: boolean;
    defs: boolean;
    incremental: boolean;
  } | null>(null);
  // Remaining auto-repeats for the "Run ×3" button.
  const multiRemainingRef = useRef(0);
  // Chain generation. Bumped by every launch, stop and unmount; the 400 ms
  // chain-restart timeout captures it at arm time and becomes a no-op once
  // it moves on — an armed chain can never start a run the user has since
  // stopped, replaced or navigated away from. (Recording itself needs no
  // generation: the settled handshake is edge-triggered by construction.)
  const runGenRef = useRef(0);

  const basePayload = payload || DEFAULT_PAYLOAD;
  // Defs are appended AFTER scaling: one definitions tail per document
  // regardless of scale, so label-mutation work stays scale-invariant and
  // the repeat seam never glues a def line onto the next repetition.
  const effectivePayload = useMemo(() => {
    const scaled = basePayload.repeat(payloadScale);
    return defsEnabled ? withDefs(scaled) : scaled;
  }, [basePayload, payloadScale, defsEnabled]);
  const payloadChars = effectivePayload.length;
  const payloadBlocks = useMemo(() => countBlocks(effectivePayload), [effectivePayload]);
  const scenarios = useMemo(() => buildScenarios(effectivePayload), [effectivePayload]);

  const stop = useCallback(() => {
    runGenRef.current += 1; // inert any armed chain timer
    // Reset the chain bookkeeping (the counter itself is unreachable after
    // the gen bump, but a half-open chain must not keep controls disabled).
    multiRemainingRef.current = 0;
    setChainPending(false);
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
    runGenRef.current += 1; // a new run supersedes any armed chain timer
    cancelRef.current?.();
    begin();
    pendingRunRef.current = {
      scenario,
      scale: payloadScale,
      chars: payloadChars,
      blocks: payloadBlocks,
      spy: spyEnabled,
      registry: registryEnabled,
      defs: defsEnabled,
      incremental: incrementalEnabled,
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
    defsEnabled,
    incrementalEnabled,
  ]);

  // Latest `launch` behind a stable ref so the record effect can chain
  // multi-runs without listing it (whose identity changes with config)
  // as a dep and re-firing on config edits.
  const launchRef = useRef(launch);
  useEffect(() => {
    launchRef.current = launch;
  });

  // A manual start is a fresh gesture: drop any leftover auto-repeat debt
  // and its controls lock. A plain () => void, so stories can pass it
  // directly as an onClick handler.
  const start = useCallback(() => {
    multiRemainingRef.current = 0;
    setChainPending(false);
    launch();
  }, [launch]);

  const startMulti = useCallback(() => {
    multiRemainingRef.current = 2; // this run + 2 repeats = 3 total
    setChainPending(true);
    launch();
  }, [launch]);

  // Record a finished run into history — handshake-driven. The profilers
  // mark the ONE snapshot they publish after `running` flips false as
  // `settled`; this effect re-runs on every snapshot change and records
  // exactly when both sides' settled finals are in. No timer: a slow
  // cross-process final records when it arrives (never with the tail
  // missing), and an externally wiped snapshot (frame remount, theme
  // change) is settled:false and simply keeps the record waiting until the
  // next launch overwrites the pending config.
  useEffect(() => {
    if (running) return;
    const pending = pendingRunRef.current;
    if (!pending) return;
    if (!enabledSnapshot.settled || !disabledSnapshot.settled) return;
    // Consume synchronously (so a snapshot re-publish can't double-record),
    // act in a microtask: the state updates run in a callback, off the
    // effect body's synchronous path, and nothing can interleave before a
    // same-task microtask — the captured snapshots stay the settled finals.
    pendingRunRef.current = null;
    const enabled = enabledSnapshot;
    const disabled = disabledSnapshot;
    queueMicrotask(() => {
      if (enabled.actual.count === 0 || disabled.actual.count === 0) {
        // Settled with zero commits: a genuinely empty run. Nothing worth
        // recording, and chaining more of the same would repeat it —
        // cancel the batch outright.
        multiRemainingRef.current = 0;
        setChainPending(false);
        return;
      }
      const rec: RunRecord = {
        at: new Date().toLocaleTimeString(),
        scenario: pending.scenario,
        scale: pending.scale,
        chars: pending.chars,
        blocks: pending.blocks,
        spy: pending.spy,
        registry: pending.registry,
        defs: pending.defs,
        incremental: pending.incremental,
        deltaTotal: disabled.actual.total - enabled.actual.total,
        deltaP95: disabled.actual.p95 - enabled.actual.p95,
        deltaElem: pending.spy ? disabled.elementRenders.total - enabled.elementRenders.total : null,
      };
      setRuns((prev) => [...prev.slice(-11), rec]);
      if (multiRemainingRef.current > 0) {
        multiRemainingRef.current -= 1;
        const gen = runGenRef.current;
        // Breather between chained runs (UX pacing, not a settle guess).
        window.setTimeout(() => {
          if (gen !== runGenRef.current) return; // superseded — no chain
          launchRef.current();
        }, 400);
      } else {
        setChainPending(false);
      }
    });
  }, [running, enabledSnapshot, disabledSnapshot]);

  useEffect(
    () => () => {
      runGenRef.current += 1; // unmount inerts an armed chain timer
      cancelRef.current?.();
    },
    []
  );

  // `chars` covers every payload-shape change (scale, defs tail, custom
  // story payloads) — runs from differently-shaped documents must never
  // share a noise band; the explicit flags keep the intent readable.
  const sameConfigRuns = useMemo(
    () =>
      runs.filter(
        (r) =>
          r.scenario === scenario &&
          r.scale === payloadScale &&
          r.chars === payloadChars &&
          r.spy === spyEnabled &&
          r.registry === registryEnabled &&
          r.defs === defsEnabled &&
          r.incremental === incrementalEnabled
      ),
    [runs, scenario, payloadScale, payloadChars, spyEnabled, registryEnabled, defsEnabled, incrementalEnabled]
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
    defsEnabled,
    setDefsEnabled,
    incrementalEnabled,
    setIncrementalEnabled,
    runs,
    clearRuns,
    sameConfigRuns,
    payloadChars,
    payloadBlocks,
    scenarios,
    start,
    startMulti,
    stop,
    /** True while a run streams OR a Run ×3 batch is mid-chain — stories
     *  disable config controls on this so a batch stays one config. */
    busy: running || chainPending,
  };
}
