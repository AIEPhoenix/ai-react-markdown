'use client';

import { Profiler, memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import AIMarkdown from '../../src/index';
import { MaybeCoordinated } from './MaybeCoordinated';
import { DEFAULT_PAYLOAD, SCENARIO_KEYS, type ScenarioKey } from './scenarios';
import { useRenderProfiler, type RenderProfilerSnapshot } from './useRenderProfiler';
import { ProfilerPanel } from './ProfilerPanel';
import { createSpyComponents } from './spyComponents';
import { controlStyles, getStreamingTheme, thinScrollbar, type ColorScheme } from './theme';
import { PAYLOAD_SCALES, useComparisonRuns, type PayloadScale, type RunRecord } from './useComparisonRuns';

interface BlockMemoComparisonProps {
  colorScheme: ColorScheme;
  initialScenario?: ScenarioKey;
  /** Run the initial scenario automatically on mount. Default true. */
  autoStart?: boolean;
  /** Base markdown payload used by every scenario (multiplied by the payload
   *  scale selector). Falls back to DEFAULT_PAYLOAD. */
  payload?: string;
}

const fmt = (n: number, digits = 2) => (Number.isFinite(n) && !Number.isNaN(n) ? n.toFixed(digits) : '—');

const fmtPct = (n: number) => (Number.isFinite(n) && !Number.isNaN(n) ? `${(n * 100).toFixed(1)}%` : '—');

const fmtSigned = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), digits)}`;

/**
 * Labels for the comparison axis. The verdict/summary/history components are
 * measurement-generic (two snapshots in, prose out); these labels let the
 * ISOLATED host reuse them for the incremental-parse A/B without forking
 * the copy. Same-page BlockMemoComparison switches to the boost axis when
 * its incremental toggle is ON (the enabled column is then memo+incremental).
 */
export interface ComparisonAxisLabels {
  /** Noun used in verdict prose. */
  subject: string;
  /** Column headers in the summary table. */
  onLabel: string;
  offLabel: string;
  /** Hint for the element-renders row when spies are on. */
  spyHint: string;
  /** Hint for the DOM-mutations row. */
  domHint: string;
  /** Whether render-layer deltas (element renders, memo effectiveness) are
   *  a WIN for this axis. False on the incremental axis: both sides run
   *  block-memo, those metrics should MATCH, and a delta is a bug signal —
   *  crowning a winner there contradicts the row's own hint. */
  renderDeltasMeaningful: boolean;
  /** Whether the block-memo cache-accounting prose in the verdict details
   *  ("固定记账成本 > 可省工作量" etc.) applies. Only true when the OFF
   *  side is the uncached legacy path AND the delta is attributable to the
   *  block cache — i.e. the block-memo axis itself. */
  blockMemoProse: boolean;
}

export const BLOCK_MEMO_AXIS: ComparisonAxisLabels = {
  renderDeltasMeaningful: true,
  blockMemoProse: true,
  subject: 'block-memo',
  onLabel: 'blockMemo on',
  offLabel: 'blockMemo off',
  spyHint:
    'spy customComponents count each invocation; block-memo skips invoking cached subtrees → the cleanest react-scan-style measure. NOTE: the spies themselves add cost proportional to this count, slightly inflating the legacy side’s commit times.',
  domHint:
    'expected to match — React’s reconciler already skips DOM for unchanged subtrees in BOTH paths. Block-memo saves the JS decision cost (commit ms), not the DOM op. Treat large divergence as a bug signal.',
};

export const BOOST_AXIS: ComparisonAxisLabels = {
  renderDeltasMeaningful: true,
  blockMemoProse: false,
  subject: 'boost（双开）',
  onLabel: 'boost on (memo+incremental)',
  offLabel: 'legacy (all off)',
  spyHint:
    'spy customComponents count each invocation; the fully-optimized side skips invoking cached subtrees → the invocation gap is the render-layer share of the boost. NOTE: spies add cost proportional to this count, dragging the legacy side slightly more.',
  domHint:
    'expected to match — all paths are byte-identical by contract (byteEquivalence + splice equivalence). Treat divergence as a bug signal.',
};

export const INCREMENTAL_AXIS: ComparisonAxisLabels = {
  renderDeltasMeaningful: false,
  blockMemoProse: false,
  subject: 'incremental parse',
  onLabel: 'incremental on',
  offLabel: 'incremental off',
  spyHint:
    'both sides run block-memo, so component invocation counts should MATCH — incremental parsing saves parse time, not render work. A persistent delta here is a bug signal, not a win.',
  domHint:
    'must match — the flag is contractually invisible in output (splice equivalence). Treat ANY divergence as a bug signal.',
};

interface SummaryStat {
  label: string;
  enabled: string;
  disabled: string;
  delta: string;
  /** 'enabled' if enabled side wins, 'disabled' if disabled wins, undefined if neutral. */
  winner?: 'enabled' | 'disabled';
  /** Tooltip-like secondary text explaining the metric. */
  hint?: string;
}

/**
 * Side-by-side comparison of `<AIMarkdown>` with `blockMemoEnabled: true` vs
 * `false`. Both sides receive the same stream of content updates and each
 * has its own `useRenderProfiler` capturing:
 * - React commit timing (actualDuration + baseDuration percentiles)
 * - DOM mutation counts (per-side MutationObserver)
 * - FPS and long tasks (rAF + PerformanceObserver)
 *
 * Measurement-honesty features (added after a small-payload run was misread
 * as a regression — twice):
 * - **Noise band**: the headline refuses to declare a winner when |delta| is
 *   within the run-to-run variance envelope; a plain-language verdict panel
 *   spells out what the numbers do and do not show.
 * - **Payload scale (1×/4×/16×)**: block-memo's benefit grows linearly with
 *   document length while its bookkeeping cost is ~constant, so the default
 *   ~840-char payload sits in a noise-dominated regime by design. The scale
 *   selector makes the regime explicit, and the payload size is always shown.
 * - **Run history**: every completed run is recorded (scenario, payload,
 *   deltas) so cross-run comparisons don't rely on memory. ≥3 same-config
 *   runs widen the noise band with 2×stddev; ≥5 let the measured spread
 *   also TIGHTEN it below the heuristic floor (see noiseBandMs).
 * - **Spy toggle**: the component-count spies add per-invocation overhead
 *   that scales WITH the render count — i.e. it drags the legacy side more,
 *   slightly exaggerating block-memo's win. Turn spies off for clean timing.
 * - **Registry toggle**: wraps both sides in AIMarkdownDocuments so the
 *   coordinated-mode PASS 0 def-label scan runs per token — the primary
 *   chat-UI configuration, whose cost the standalone mode never shows.
 *   Runs are recorded per mode; the noise band never mixes the two.
 *   Pair it with the **defs toggle** (withDefs in scenarios.ts): the
 *   default payload has zero definitions, so registry mode alone measures
 *   the scanner on a best-case input. Scope honesty: even with defs ON,
 *   the cross-chunk PHANTOM path stays cold — each side is a single chunk,
 *   so no label is ever defined "elsewhere" (see withDefs docs).
 * - **Seeded stream**: scenario F replays the identical chunk pattern every
 *   run (see scenarios.ts), removing between-run stream variance.
 * - **Swap sides**: render order inside the shared commit is fixed (enabled
 *   subtree first); swapping verifies a conclusion isn't an ordering
 *   artifact.
 *
 * Caveats (read these before drawing conclusions):
 * - Storybook runs a dev build of React. Absolute numbers are inflated;
 *   trust the ratio between the two columns, not absolute values.
 * - Long tasks / fps are page-wide — both sides will see identical counts.
 * - First 3 commits per side are excluded from stats as JIT warm-up.
 */
export const BlockMemoComparison = ({
  colorScheme,
  initialScenario = 'randomTokens',
  autoStart = true,
  payload = DEFAULT_PAYLOAD,
}: BlockMemoComparisonProps) => {
  const [swapped, setSwapped] = useState(false);
  const [content, setContent] = useState('');
  const [running, setRunning] = useState(false);

  // observeStages on the ENABLED side only: the stage measures are
  // page-wide and only the block-memo path emits them — observing on both
  // would print the same union under the legacy panel.
  const enabledProfiler = useRenderProfiler<HTMLDivElement>({ running, observeStages: true });
  const disabledProfiler = useRenderProfiler<HTMLDivElement>({ running });
  const theme = getStreamingTheme(colorScheme);

  // Same-page transport: one setState feeds both sides inside the same
  // commit; run bookkeeping (history, Run ×3, noise-band inputs) lives in
  // the shared useComparisonRuns hook.
  const begin = useCallback(() => {
    setContent('');
    enabledProfiler.reset();
    disabledProfiler.reset();
  }, [enabledProfiler, disabledProfiler]);
  const push = useCallback(
    (chunk: string) => {
      enabledProfiler.recordChunk(chunk);
      disabledProfiler.recordChunk(chunk);
      setContent((prev) => prev + chunk);
    },
    [enabledProfiler, disabledProfiler]
  );

  const {
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
    busy,
  } = useComparisonRuns({
    payload,
    initialScenario,
    running,
    setRunning,
    enabledSnapshot: enabledProfiler.snapshot,
    disabledSnapshot: disabledProfiler.snapshot,
    begin,
    push,
  });

  useEffect(() => {
    if (!autoStart) return;
    start();
    // Unmount cancellation lives in useComparisonRuns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The incremental toggle applies to the ENABLED column only — incremental
  // parsing lives inside the block-memo renderer (since v2 it splices in
  // registry mode too, via always-tail phantom suffixes, so combining the
  // toggles measures the real coordinated splice).
  const enabledConfig = useMemo(
    () => ({ blockMemoEnabled: true, incrementalParseEnabled: incrementalEnabled }) as const,
    [incrementalEnabled]
  );
  const disabledConfig = useMemo(() => ({ blockMemoEnabled: false }) as const, []);

  // Spy customComponents — count component-function invocations per side.
  // Each side gets its OWN stable spy object so the two profilers don't
  // share counts (and so the spy reference is stable across renders —
  // otherwise it would trip block-memo's G3 cache-flush every frame).
  // `undefined` when spies are off → clean-timing mode (the spies' own
  // per-invocation overhead scales with render count and therefore drags
  // the legacy side more).
  const enabledSpy = useMemo(
    () => (spyEnabled ? createSpyComponents(enabledProfiler.recordElementRender) : undefined),
    [spyEnabled, enabledProfiler.recordElementRender]
  );
  const disabledSpy = useMemo(
    () => (spyEnabled ? createSpyComponents(disabledProfiler.recordElementRender) : undefined),
    [spyEnabled, disabledProfiler.recordElementRender]
  );

  // Recompute per snapshot tick, not per host render — the host re-renders
  // once per streamed chunk (setContent) on the same main thread both
  // measured sides share during the measurement window.
  // With the incremental toggle ON the enabled column is memo+incremental
  // vs legacy — the BOOST comparison. Attribute the verdict/summary/history
  // accordingly, or a 16× win would be quoted as "block-memo saved X ms"
  // while X contains the (dominant) parse-side saving.
  const activeAxis = incrementalEnabled ? BOOST_AXIS : BLOCK_MEMO_AXIS;
  const summary = useMemo(
    () =>
      computeSummary(
        enabledProfiler.snapshot,
        disabledProfiler.snapshot,
        spyEnabled,
        sameConfigRuns,
        false,
        activeAxis
      ),
    [enabledProfiler.snapshot, disabledProfiler.snapshot, spyEnabled, sameConfigRuns, activeAxis]
  );
  const scenarioConfig = scenarios[scenario];

  const controls = controlStyles(theme);
  const splitStyle: CSSProperties = {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  };
  const panelHeaderStyle: CSSProperties = {
    color: theme.text,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.4,
    margin: 0,
    textTransform: 'uppercase',
  };
  const renderSurfaceStyle: CSSProperties = {
    border: `1px solid ${theme.surfaceBorder}`,
    borderRadius: 8,
    height: 320,
    overflow: 'auto',
    padding: 16,
    ...thinScrollbar(theme),
  };

  // Registry mode: wrap each side in its OWN AIMarkdownDocuments (separate
  // registries — fair A/B) and pass an explicit documentId, which is what
  // opts a chunk into coordination. This runs the per-token PASS 0 def-label
  // scan on both sides — the coordinated-mode cost the standalone story
  // never shows.
  const enabledMarkdown = (
    <AIMarkdown
      content={content}
      streaming={running}
      colorScheme={colorScheme}
      config={enabledConfig}
      customComponents={enabledSpy}
      documentId={registryEnabled ? 'bmc-enabled' : undefined}
    />
  );
  const disabledMarkdown = (
    <AIMarkdown
      content={content}
      streaming={running}
      colorScheme={colorScheme}
      config={disabledConfig}
      customComponents={disabledSpy}
      documentId={registryEnabled ? 'bmc-disabled' : undefined}
    />
  );

  const enabledSide = (
    <div key="enabled" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h4 style={panelHeaderStyle}>
        <span style={{ color: theme.good }}>● </span>blockMemoEnabled: true (default)
      </h4>
      <div style={renderSurfaceStyle} ref={enabledProfiler.targetRef}>
        <Profiler id="comparison-enabled" onRender={enabledProfiler.onRender}>
          <MaybeCoordinated enabled={registryEnabled}>{enabledMarkdown}</MaybeCoordinated>
        </Profiler>
      </div>
      <ProfilerPanel snapshot={enabledProfiler.snapshot} colorScheme={colorScheme} compact />
    </div>
  );

  const disabledSide = (
    <div key="disabled" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h4 style={panelHeaderStyle}>
        <span style={{ color: theme.warn }}>● </span>blockMemoEnabled: false (legacy)
      </h4>
      <div style={renderSurfaceStyle} ref={disabledProfiler.targetRef}>
        <Profiler id="comparison-disabled" onRender={disabledProfiler.onRender}>
          <MaybeCoordinated enabled={registryEnabled}>{disabledMarkdown}</MaybeCoordinated>
        </Profiler>
      </div>
      <ProfilerPanel snapshot={disabledProfiler.snapshot} colorScheme={colorScheme} compact />
    </div>
  );

  return (
    <div style={controls.layout}>
      <div style={controls.buttonRow}>
        {SCENARIO_KEYS.map((key) => (
          <button
            key={key}
            disabled={busy}
            onClick={() => setScenario(key)}
            style={scenario === key ? controls.primaryButton : controls.baseButton}
          >
            {scenarios[key].label}
          </button>
        ))}
      </div>

      <div style={controls.buttonRow}>
        <span style={controls.caption}>payload</span>
        {PAYLOAD_SCALES.map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => setPayloadScale(s)}
            style={payloadScale === s ? controls.primaryButton : controls.baseButton}
          >
            {s}×
          </button>
        ))}
        <span style={controls.caption}>
          {payloadChars.toLocaleString()} chars / {payloadBlocks} blocks
        </span>
        <span style={{ ...controls.caption, marginLeft: 8 }}>·</span>
        <button
          disabled={busy}
          onClick={() => setSpyEnabled((v) => !v)}
          style={controls.baseButton}
          title="Spies count component invocations but add overhead that scales with render count (drags the legacy side more). Turn OFF for the cleanest timing."
        >
          spy: {spyEnabled ? 'ON (component counts)' : 'OFF (clean timing)'}
        </button>
        <button
          disabled={busy}
          onClick={() => setRegistryEnabled(!registryEnabled)}
          style={controls.baseButton}
          title="Wraps both sides in AIMarkdownDocuments (coordinated mode): the per-token PASS 0 def-label scan runs on each side — the cross-chunk coordination overhead the standalone mode skips."
        >
          registry: {registryEnabled ? 'ON (coordinated)' : 'OFF (standalone)'}
        </button>
        <button
          disabled={busy}
          onClick={() => setDefsEnabled(!defsEnabled)}
          style={controls.baseButton}
          title="Appends a footnote/link-reference definitions tail (plus in-text references) to the scaled payload. The default payload has zero defs, so registry mode alone measures the def-label scanner on a best-case input. Note: the cross-chunk phantom path still doesn't run — each side is a single chunk."
        >
          defs: {defsEnabled ? 'ON (defs tail appended)' : 'OFF'}
        </button>
        <button
          disabled={busy}
          onClick={() => setIncrementalEnabled(!incrementalEnabled)}
          style={controls.baseButton}
          title="Enables incrementalParseEnabled (prefix-freeze parsing) on the block-memo side: streaming appends freeze the stable prefix and re-parse only the tail. Watch the scan/parse/transform stage panel — parse should drop to the tail's share. Since v2 footnote payloads (defs ON) and registry mode splice too; unresolved references hold the boundary until their defs settle."
        >
          incremental: {incrementalEnabled ? 'ON (prefix-freeze)' : 'OFF (full parse per frame)'}
        </button>
        <button disabled={busy} onClick={() => setSwapped((v) => !v)} style={controls.baseButton}>
          ⇄ swap sides
        </button>
      </div>

      <div style={controls.buttonRow}>
        <button onClick={running ? stop : start} style={controls.primaryButton}>
          {running ? 'Stop' : 'Run scenario'}
        </button>
        <button
          disabled={busy}
          onClick={startMulti}
          style={controls.baseButton}
          title="Run the same config 3 times back-to-back to expose run-to-run variance."
        >
          Run ×3
        </button>
        <button
          onClick={() => {
            stop();
            begin();
          }}
          style={controls.baseButton}
        >
          Reset
        </button>
      </div>

      <div style={controls.caption}>
        <div>
          <strong style={{ color: theme.text }}>{scenarioConfig.label}</strong>
        </div>
        <div style={{ marginTop: 2 }}>{scenarioConfig.description}</div>
        <div style={{ marginTop: 2, opacity: 0.85 }}>{scenarioConfig.hypothesis}</div>
      </div>

      <VerdictBanner
        summary={summary}
        sameConfigRuns={sameConfigRuns}
        payloadScale={payloadScale}
        payloadChars={payloadChars}
        payloadBlocks={payloadBlocks}
        spyEnabled={spyEnabled}
        colorScheme={colorScheme}
        axis={activeAxis}
      />

      <SummaryBanner summary={summary} colorScheme={colorScheme} axis={activeAxis} />

      <div style={splitStyle}>{swapped ? [disabledSide, enabledSide] : [enabledSide, disabledSide]}</div>

      <RunHistory runs={runs} onClear={clearRuns} colorScheme={colorScheme} axis={activeAxis} />
    </div>
  );
};

export interface ComparisonSummary {
  stats: SummaryStat[];
  totalCommitSavingsMs: number;
  totalCommitSavingsFraction: number;
  /** |delta| below this is indistinguishable from run-to-run variance. */
  noiseMs: number;
  withinNoise: boolean;
  deltaP95: number;
  deltaElem: number | null;
  /** True once both sides have at least one post-warmup commit. */
  bothActive: boolean;
}

/** Sample standard deviation; 0 for n < 2. */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/**
 * Noise band for the total-commit delta.
 * - <3 same-config runs: heuristic prior only — 15 ms (observed swing on an
 *   idle machine) or 4% of the larger side's total, whichever is bigger.
 * - 3–4 runs: the measured 2×stddev can only WIDEN the band; too few
 *   samples to trust a narrow spread.
 * - ≥5 runs: the measurement wins — 2×stddev floored at 5 ms (timer
 *   resolution), so a quiet machine can tighten below the prior and a
 *   small-but-reproducible win stops reading as a permanent tie, while a
 *   noisy machine's band grows to its real variance.
 */
function noiseBandMs(enabledTotal: number, disabledTotal: number, sameConfigRuns: RunRecord[]): number {
  const heuristic = Math.max(15, 0.04 * Math.max(enabledTotal, disabledTotal));
  const deltas = sameConfigRuns.map((r) => r.deltaTotal);
  if (deltas.length >= 5) return Math.max(5, 2 * stddev(deltas));
  if (deltas.length >= 3) return Math.max(heuristic, 2 * stddev(deltas));
  return heuristic;
}

export function computeSummary(
  enabled: RenderProfilerSnapshot,
  disabled: RenderProfilerSnapshot,
  spyEnabled: boolean,
  sameConfigRuns: RunRecord[],
  /** True when the two sides run in separate processes (cross-site iframes):
   *  frame/jank signals are then genuinely per-side and get a winner. */
  isolated = false,
  axis: ComparisonAxisLabels = BLOCK_MEMO_AXIS
): ComparisonSummary {
  const bothActive = enabled.actual.count > 0 && disabled.actual.count > 0;
  const totalDelta = disabled.actual.total - enabled.actual.total;
  const totalFraction = disabled.actual.total > 0 ? totalDelta / disabled.actual.total : 0;
  const noiseMs = noiseBandMs(enabled.actual.total, disabled.actual.total, sameConfigRuns);
  const withinNoise = Math.abs(totalDelta) < noiseMs;

  const pickWinner = (e: number, d: number, lowerIsBetter = true): SummaryStat['winner'] => {
    if (!Number.isFinite(e) || !Number.isFinite(d) || e === d) return undefined;
    const enabledWins = lowerIsBetter ? e < d : e > d;
    return enabledWins ? 'enabled' : 'disabled';
  };

  const deltaStr = (e: number, d: number, digits = 2) => (bothActive ? fmtSigned(e - d, digits) : '—');

  const stats: SummaryStat[] = [
    {
      label: 'p50 commit (ms)',
      enabled: fmt(enabled.actual.p50),
      disabled: fmt(disabled.actual.p50),
      delta: deltaStr(enabled.actual.p50, disabled.actual.p50),
      winner: pickWinner(enabled.actual.p50, disabled.actual.p50),
      hint: 'typical commit cost — less affected by outliers than mean',
    },
    {
      label: 'p95 commit (ms)',
      enabled: fmt(enabled.actual.p95),
      disabled: fmt(disabled.actual.p95),
      delta: deltaStr(enabled.actual.p95, disabled.actual.p95),
      winner: pickWinner(enabled.actual.p95, disabled.actual.p95),
      hint: 'worst-1-in-20 commit — best proxy for perceived jank',
    },
    {
      label: 'total commit (ms)',
      enabled: fmt(enabled.actual.total, 1),
      disabled: fmt(disabled.actual.total, 1),
      delta: deltaStr(enabled.actual.total, disabled.actual.total, 1),
      // Within the noise band, refuse to crown a winner on total.
      winner: withinNoise ? undefined : pickWinner(enabled.actual.total, disabled.actual.total),
      hint: `cumulative React work over the whole run · noise band ±${fmt(noiseMs, 0)}ms`,
    },
    {
      label: 'memo effectiveness',
      enabled: fmtPct(enabled.memoEffectiveness),
      disabled: fmtPct(disabled.memoEffectiveness),
      delta: bothActive
        ? `${enabled.memoEffectiveness - disabled.memoEffectiveness >= 0 ? '+' : '−'}${fmtPct(
            Math.abs(enabled.memoEffectiveness - disabled.memoEffectiveness)
          )}`
        : '—',
      winner: axis.renderDeltasMeaningful
        ? pickWinner(enabled.memoEffectiveness, disabled.memoEffectiveness, false /* higher is better */)
        : undefined,
      hint: '(base − actual) / base; how much memoization is saving on each side',
    },
    {
      label: 'element renders',
      enabled: spyEnabled ? String(enabled.elementRenders.total) : 'spy off',
      disabled: spyEnabled ? String(disabled.elementRenders.total) : 'spy off',
      delta: spyEnabled ? deltaStr(enabled.elementRenders.total, disabled.elementRenders.total, 0) : '—',
      winner:
        spyEnabled && axis.renderDeltasMeaningful
          ? pickWinner(enabled.elementRenders.total, disabled.elementRenders.total)
          : undefined,
      hint: spyEnabled ? axis.spyHint : 'spies disabled — clean-timing mode. Re-enable to count component invocations.',
    },
    {
      label: 'DOM mutations',
      enabled: String(enabled.dom.total),
      disabled: String(disabled.dom.total),
      delta: deltaStr(enabled.dom.total, disabled.dom.total, 0),
      // No winner: this metric SHOULD match between the two paths.
      hint: axis.domHint,
    },
    {
      label: 'slow frames (<30fps)',
      enabled: String(enabled.slowFrameCount),
      disabled: String(disabled.slowFrameCount),
      delta: deltaStr(enabled.slowFrameCount, disabled.slowFrameCount, 0),
      // Same-page mode: no winner — rAF is page-wide, two side-by-side
      // profilers observe near-identical frame cadence. Isolated mode
      // (cross-site iframes → separate processes): each side has its own
      // event loop and frame cadence, so the count is genuinely per-side.
      winner: isolated ? pickWinner(enabled.slowFrameCount, disabled.slowFrameCount) : undefined,
      hint: isolated
        ? 'PER-SIDE (each iframe runs its own process and rAF loop). A real difference here means one side actually janked more.'
        : 'PAGE-WIDE (rAF is per page, not per Profiler boundary). Expected to match. Treat as a scenario-level jank indicator.',
    },
  ];

  return {
    stats,
    totalCommitSavingsMs: totalDelta,
    totalCommitSavingsFraction: totalFraction,
    noiseMs,
    withinNoise,
    deltaP95: disabled.actual.p95 - enabled.actual.p95,
    deltaElem: spyEnabled ? disabled.elementRenders.total - enabled.elementRenders.total : null,
    bothActive,
  };
}

/**
 * Plain-language verdict — states, in ordinary words, what this run does
 * and does not prove. Exists because a bare "−126 ms" headline was misread
 * as a block-memo regression twice: the real story was a noise-dominated
 * tiny-payload regime. The verdict encodes that interpretation so the
 * reader doesn't have to.
 *
 * Memoized (as are SummaryBanner/RunHistory): the host re-renders once per
 * streamed chunk on the thread the measured sides share, while these
 * banners' inputs only change per snapshot tick — memo keeps their string
 * assembly out of the measurement window.
 */
export const VerdictBanner = memo(function VerdictBanner({
  summary,
  sameConfigRuns,
  payloadScale,
  payloadChars,
  payloadBlocks,
  spyEnabled,
  colorScheme,
  isolated = false,
  axis = BLOCK_MEMO_AXIS,
}: {
  summary: ComparisonSummary;
  sameConfigRuns: RunRecord[];
  payloadScale: PayloadScale;
  payloadChars: number;
  payloadBlocks: number;
  spyEnabled: boolean;
  colorScheme: ColorScheme;
  isolated?: boolean;
  axis?: ComparisonAxisLabels;
}) {
  const theme = getStreamingTheme(colorScheme);
  if (!summary.bothActive) return null;

  const d = summary.totalCommitSavingsMs;
  const pct = fmtPct(Math.abs(summary.totalCommitSavingsFraction));
  const noise = fmt(summary.noiseMs, 0);

  let accent = theme.textMuted;
  let headline: string;
  const details: string[] = [];

  if (summary.withinNoise) {
    headline = `两边基本打平：这轮 ${axis.subject} ${d >= 0 ? '快' : '慢'}了 ${fmt(Math.abs(d), 1)} ms（${pct}），在本机的运行波动（约 ±${noise} ms）之内 —— 这个差值说明不了谁快谁慢。`;
    if (payloadScale === 1 && payloadChars < 4000) {
      details.push(
        axis.blockMemoProse
          ? `当前内容只有 ${payloadChars.toLocaleString()} 字符 / ${payloadBlocks} 个块。内容越短，可复用的渲染就越少，而缓存本身的记账成本不变 —— 小文档打平是预期行为，不是坏事。想看真实收益，切到 4× 或 16× payload 再跑。`
          : `当前内容只有 ${payloadChars.toLocaleString()} 字符 / ${payloadBlocks} 个块 —— 小文档下差值容易被噪音吞没。想看真实收益，切到 4× 或 16× payload 再跑。`
      );
    }
  } else if (d > 0) {
    accent = theme.good;
    headline = `${axis.subject} 赢了：整轮少花 ${fmt(d, 1)} ms（省 ${pct}），超出噪音带（±${noise} ms），是真实差距。`;
    if (summary.deltaP95 > 0.5) {
      details.push(`最卡的那 5% 次提交快了 ${fmt(summary.deltaP95, 1)} ms —— 这对应用户能感觉到的卡顿改善。`);
    }
    if (axis.renderDeltasMeaningful && summary.deltaElem !== null && summary.deltaElem > 0) {
      details.push(`组件函数少执行了 ${summary.deltaElem.toLocaleString()} 次（缓存命中的块直接复用上一帧的结果）。`);
    }
  } else {
    accent = theme.bad;
    headline = `这轮 ${axis.subject} 确实更慢：多花 ${fmt(Math.abs(d), 1)} ms（${pct}），超出噪音带（±${noise} ms）。`;
    if (axis.blockMemoProse && payloadScale === 1) {
      details.push(
        `小 payload 下这通常仍是"固定记账成本 > 可省工作量"的体现。先切到 16× 复测：如果大 payload 也稳定为负，才值得当回归去查。`
      );
    } else {
      details.push(`稳定复现的话建议用 Run ×3 确认，然后查最近的热路径改动。`);
    }
  }

  if (sameConfigRuns.length >= 2) {
    const deltas = sameConfigRuns.map((r) => r.deltaTotal);
    const mean = deltas.reduce((s, x) => s + x, 0) / deltas.length;
    details.push(
      `同配置最近 ${deltas.length} 轮的差值：${deltas.map((x) => fmtSigned(x)).join(' / ')} ms（平均 ${fmtSigned(mean)}，波动 ±${fmt(stddev(deltas), 1)}）。`
    );
  }

  const footnotes = [
    '毫秒数来自 React dev 构建，绝对值偏大；只有左右两侧的相对差有意义。',
    spyEnabled
      ? `组件计数 spy 是开着的：它对渲染次数多的一侧拖累更大，可能略微影响 ${axis.subject} 的相对优势。要最干净的计时，关掉 spy 再跑。`
      : '组件计数 spy 已关闭 —— 当前是最干净的计时模式。',
    isolated
      ? '两栏跑在两个独立进程（跨站 iframe）：线程、GC、帧率互不影响，fps / slow frames / long tasks 是真·每侧指标；但 CPU 核心、内存带宽、GPU、温控仍是整机共享的。'
      : 'fps / slow frames / long tasks 是整页共享的信号，两栏数字相同属正常；两栏跑在同一条主线程上，排版/绘制/GC 是共享的 —— 本页公正比较的是 React 的 JS 工作量。',
  ];

  const banner: CSSProperties = {
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '12px 16px',
  };

  return (
    <div style={banner}>
      <div
        style={{
          color: theme.textMuted,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: accent }}>● </span>最终结论
      </div>
      <div style={{ color: theme.text, fontSize: 13, lineHeight: 1.6 }}>{headline}</div>
      {details.map((line) => (
        <div key={line} style={{ color: theme.text, fontSize: 12, lineHeight: 1.6, opacity: 0.9 }}>
          {line}
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${theme.panelBorder}`, marginTop: 4, paddingTop: 6 }}>
        {footnotes.map((line) => (
          <div key={line} style={{ color: theme.textMuted, fontSize: 11, lineHeight: 1.6 }}>
            · {line}
          </div>
        ))}
      </div>
    </div>
  );
});

/** Scenario letter for the history table — derived from the key's position
 *  in SCENARIO_KEYS (labels are prefixed 'A.'…'F.' in that order), so
 *  adding or reordering scenarios can't desync a hand-maintained map. */
const scenarioLetter = (key: ScenarioKey): string => String.fromCharCode(65 + SCENARIO_KEYS.indexOf(key));

/** History of completed runs — makes cross-run comparison a table lookup
 *  instead of a memory exercise. */
export const RunHistory = memo(function RunHistory({
  runs,
  onClear,
  colorScheme,
  axis = BLOCK_MEMO_AXIS,
}: {
  runs: RunRecord[];
  onClear: () => void;
  colorScheme: ColorScheme;
  axis?: ComparisonAxisLabels;
}) {
  const theme = getStreamingTheme(colorScheme);
  if (runs.length === 0) return null;
  const mono: CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 11,
  };
  const cell: CSSProperties = { ...mono, color: theme.text, padding: '2px 10px 2px 0', textAlign: 'left' };
  const head: CSSProperties = { ...cell, color: theme.textMuted, fontWeight: 400 };
  const deltaColor = (v: number) => (v > 0 ? theme.good : v < 0 ? theme.bad : theme.text);
  return (
    <div
      style={{
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 8,
        padding: '10px 16px',
      }}
    >
      <div style={{ alignItems: 'baseline', display: 'flex', gap: 12, marginBottom: 4 }}>
        <span
          style={{
            color: theme.textMuted,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          run history
        </span>
        <span style={{ ...mono, color: theme.textMuted }}>Δ &gt; 0 = {axis.subject} faster</span>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.textMuted,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 11,
            marginLeft: 'auto',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          clear
        </button>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={head}>time</th>
            <th style={head}>scenario</th>
            <th style={head}>payload</th>
            <th style={head}>spy</th>
            <th style={head}>reg</th>
            <th style={head}>defs</th>
            <th style={head}>inc</th>
            <th style={head}>Δ total (ms)</th>
            <th style={head}>Δ p95 (ms)</th>
            <th style={head}>Δ element renders</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map((r, i) => (
            <tr key={`${r.at}-${i}`}>
              <td style={cell}>{r.at}</td>
              <td style={cell}>{scenarioLetter(r.scenario)}</td>
              <td style={cell}>
                {r.scale}× ({r.chars.toLocaleString()}c/{r.blocks}b)
              </td>
              <td style={cell}>{r.spy ? 'on' : 'off'}</td>
              <td style={cell}>{r.registry ? 'on' : 'off'}</td>
              <td style={cell}>{r.defs ? 'on' : 'off'}</td>
              <td style={cell}>{r.incremental ? 'on' : 'off'}</td>
              <td style={{ ...cell, color: deltaColor(r.deltaTotal) }}>{fmtSigned(r.deltaTotal)}</td>
              <td style={{ ...cell, color: deltaColor(r.deltaP95) }}>{fmtSigned(r.deltaP95)}</td>
              <td style={cell}>{r.deltaElem === null ? '—' : fmtSigned(r.deltaElem, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export const SummaryBanner = memo(function SummaryBanner({
  summary,
  colorScheme,
  axis = BLOCK_MEMO_AXIS,
}: {
  summary: ComparisonSummary;
  colorScheme: ColorScheme;
  axis?: ComparisonAxisLabels;
}) {
  const theme = getStreamingTheme(colorScheme);
  const banner: CSSProperties = {
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };
  const headlineStyle: CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    color: theme.text,
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    flexWrap: 'wrap',
  };
  const headlineValueStyle: CSSProperties = {
    fontSize: 22,
    fontWeight: 700,
  };
  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
    gap: 8,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    alignItems: 'baseline',
  };
  const headerCell: CSSProperties = { color: theme.textMuted, fontSize: 11 };
  const cellStyle: CSSProperties = { color: theme.text };
  const winnerCell = (winner: SummaryStat['winner'], side: 'enabled' | 'disabled') => ({
    ...cellStyle,
    color: winner === side ? theme.good : winner && winner !== side ? theme.bad : theme.text,
    fontWeight: winner === side ? 700 : 400,
  });

  if (!summary.bothActive) {
    return (
      <div style={banner}>
        <div style={{ ...headlineStyle, color: theme.textMuted }}>
          Run a scenario to populate the comparison summary. First 3 commits per side are excluded as JIT warm-up.
        </div>
      </div>
    );
  }

  const fractionStr = fmtPct(Math.abs(summary.totalCommitSavingsFraction));
  const enabledWins = summary.totalCommitSavingsMs > 0;
  // Within the noise band the headline stays neutral — a green/red verdict
  // on a sub-noise delta is exactly the misread this page used to invite.
  const headlineColor = summary.withinNoise ? theme.textMuted : enabledWins ? theme.good : theme.bad;

  return (
    <div style={banner}>
      <div style={headlineStyle}>
        <span>Total React commit time saved by {axis.subject}:</span>
        <span style={{ ...headlineValueStyle, color: headlineColor }}>
          {summary.totalCommitSavingsMs >= 0 ? '+' : '−'}
          {fmt(Math.abs(summary.totalCommitSavingsMs), 1)} ms
        </span>
        <span style={{ color: theme.textMuted }}>
          {summary.withinNoise
            ? `(within ±${fmt(summary.noiseMs, 0)} ms noise band — treat as a tie)`
            : `(${enabledWins ? 'saved' : 'lost'} ${fractionStr} of total commit time)`}
        </span>
      </div>

      <div style={rowStyle}>
        <span style={headerCell}>metric</span>
        <span style={headerCell}>{axis.onLabel}</span>
        <span style={headerCell}>{axis.offLabel}</span>
        <span style={headerCell}>delta (on vs off)</span>
        {summary.stats.map((s) => (
          <Row
            key={s.label}
            stat={s}
            cellStyle={cellStyle}
            mutedStyle={{ color: theme.textMuted, fontSize: 10 }}
            winnerCellStyle={winnerCell}
          />
        ))}
      </div>
    </div>
  );
});

const Row = ({
  stat,
  cellStyle,
  mutedStyle,
  winnerCellStyle,
}: {
  stat: SummaryStat;
  cellStyle: CSSProperties;
  mutedStyle: CSSProperties;
  winnerCellStyle: (winner: SummaryStat['winner'], side: 'enabled' | 'disabled') => CSSProperties;
}) => (
  <>
    <span style={cellStyle}>
      {stat.label}
      {stat.hint && <div style={mutedStyle}>{stat.hint}</div>}
    </span>
    <span style={winnerCellStyle(stat.winner, 'enabled')}>{stat.enabled}</span>
    <span style={winnerCellStyle(stat.winner, 'disabled')}>{stat.disabled}</span>
    <span style={cellStyle}>{stat.delta}</span>
  </>
);
