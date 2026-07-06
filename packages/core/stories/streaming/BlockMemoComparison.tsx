'use client';

import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import AIMarkdown from '../../src/index';
import { buildScenarios, countBlocks, DEFAULT_PAYLOAD, SCENARIO_KEYS, type ScenarioKey } from './scenarios';
import { useRenderProfiler, type RenderProfilerSnapshot } from './useRenderProfiler';
import { ProfilerPanel } from './ProfilerPanel';
import { createSpyComponents } from './spyComponents';
import { getStreamingTheme, thinScrollbar, type ColorScheme } from './theme';

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
  /** disabled.total − enabled.total (ms); positive = block-memo faster. */
  deltaTotal: number;
  /** disabled.p95 − enabled.p95 (ms); positive = block-memo faster. */
  deltaP95: number;
  /** disabled − enabled element render count; null when spy was off. */
  deltaElem: number | null;
  enabledTotal: number;
  disabledTotal: number;
}

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
 *   runs sharpen the noise band with 2×stddev.
 * - **Spy toggle**: the component-count spies add per-invocation overhead
 *   that scales WITH the render count — i.e. it drags the legacy side more,
 *   slightly exaggerating block-memo's win. Turn spies off for clean timing.
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
  const [scenario, setScenario] = useState<ScenarioKey>(initialScenario);
  const [payloadScale, setPayloadScale] = useState<PayloadScale>(1);
  const [spyEnabled, setSpyEnabled] = useState(true);
  const [swapped, setSwapped] = useState(false);
  const [content, setContent] = useState('');
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);

  const basePayload = payload || DEFAULT_PAYLOAD;
  const effectivePayload = useMemo(() => basePayload.repeat(payloadScale), [basePayload, payloadScale]);
  const payloadChars = effectivePayload.length;
  const payloadBlocks = useMemo(() => countBlocks(effectivePayload), [effectivePayload]);
  const scenarios = useMemo(() => buildScenarios(effectivePayload), [effectivePayload]);

  const enabledProfiler = useRenderProfiler<HTMLDivElement>({ running });
  const disabledProfiler = useRenderProfiler<HTMLDivElement>({ running });
  const theme = getStreamingTheme(colorScheme);

  // Config of the run currently in flight — consumed by the record effect
  // when `running` flips back to false.
  const pendingRunRef = useRef<{
    scenario: ScenarioKey;
    scale: PayloadScale;
    chars: number;
    blocks: number;
    spy: boolean;
  } | null>(null);
  // Remaining auto-repeats for the "Run ×3" button.
  const multiRemainingRef = useRef(0);

  const stop = useCallback(() => {
    multiRemainingRef.current = 0;
    cancelRef.current?.();
    cancelRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    cancelRef.current?.();
    setContent('');
    enabledProfiler.reset();
    disabledProfiler.reset();
    pendingRunRef.current = {
      scenario,
      scale: payloadScale,
      chars: payloadChars,
      blocks: payloadBlocks,
      spy: spyEnabled,
    };
    setRunning(true);

    const push = (chunk: string) => {
      enabledProfiler.recordChunk(chunk);
      disabledProfiler.recordChunk(chunk);
      setContent((prev) => prev + chunk);
    };
    const done = () => setRunning(false);

    cancelRef.current = scenarios[scenario].run(push, done);
  }, [scenario, scenarios, payloadScale, payloadChars, payloadBlocks, spyEnabled, enabledProfiler, disabledProfiler]);

  // Latest `start` behind a stable ref so the record effect can chain
  // multi-runs without listing `start` (whose identity changes with config)
  // as a dep and re-firing on config edits.
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });

  const startMulti = useCallback(() => {
    multiRemainingRef.current = 2; // this run + 2 repeats = 3 total
    start();
  }, [start]);

  // Latest snapshots behind refs, for the deferred history record below.
  const enabledSnapRef = useRef(enabledProfiler.snapshot);
  enabledSnapRef.current = enabledProfiler.snapshot;
  const disabledSnapRef = useRef(disabledProfiler.snapshot);
  disabledSnapRef.current = disabledProfiler.snapshot;

  // Record a finished run into history. The profiler publishes one FINAL
  // snapshot when `running` flips false, one render after the last interval
  // tick — so recording synchronously here would capture a snapshot that
  // can still be missing the last ~100 ms of commits. Instead: arm once
  // (pending cleared immediately so re-publishes can't double-record), then
  // read the settled snapshots from refs after a short delay. No cleanup on
  // purpose — the timeout must survive the snapshot-driven effect re-runs.
  useEffect(() => {
    if (running) return;
    const pending = pendingRunRef.current;
    if (!pending) return;
    if (enabledProfiler.snapshot.actual.count === 0 || disabledProfiler.snapshot.actual.count === 0) return;
    pendingRunRef.current = null;
    window.setTimeout(() => {
      const e = enabledSnapRef.current;
      const d = disabledSnapRef.current;
      const rec: RunRecord = {
        at: new Date().toLocaleTimeString(),
        scenario: pending.scenario,
        scale: pending.scale,
        chars: pending.chars,
        blocks: pending.blocks,
        spy: pending.spy,
        deltaTotal: d.actual.total - e.actual.total,
        deltaP95: d.actual.p95 - e.actual.p95,
        deltaElem: pending.spy ? d.elementRenders.total - e.elementRenders.total : null,
        enabledTotal: e.actual.total,
        disabledTotal: d.actual.total,
      };
      setRuns((prev) => [...prev.slice(-11), rec]);
      if (multiRemainingRef.current > 0) {
        multiRemainingRef.current -= 1;
        window.setTimeout(() => startRef.current(), 400);
      }
    }, 200);
  }, [running, enabledProfiler.snapshot, disabledProfiler.snapshot]);

  useEffect(() => () => cancelRef.current?.(), []);

  useEffect(() => {
    if (!autoStart) return;
    start();
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enabledConfig = useMemo(() => ({ blockMemoEnabled: true }) as const, []);
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

  const sameConfigRuns = useMemo(
    () => runs.filter((r) => r.scenario === scenario && r.scale === payloadScale && r.spy === spyEnabled),
    [runs, scenario, payloadScale, spyEnabled]
  );
  const summary = computeSummary(enabledProfiler.snapshot, disabledProfiler.snapshot, spyEnabled, sameConfigRuns);
  const scenarioConfig = scenarios[scenario];

  const layoutStyle: CSSProperties = {
    color: theme.text,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 12,
  };
  const buttonRowStyle: CSSProperties = { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 };
  const baseButton: CSSProperties = {
    background: 'transparent',
    border: `1px solid ${theme.buttonBorder}`,
    borderRadius: 6,
    color: theme.buttonText,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
    padding: '4px 12px',
  };
  const primaryButton: CSSProperties = {
    ...baseButton,
    background: theme.primaryBg,
    border: `1px solid ${theme.primaryBg}`,
    color: theme.primaryText,
  };
  const captionStyle: CSSProperties = {
    color: theme.textMuted,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 11,
  };
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

  const enabledSide = (
    <div key="enabled" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h4 style={panelHeaderStyle}>
        <span style={{ color: theme.good }}>● </span>blockMemoEnabled: true (default)
      </h4>
      <div style={renderSurfaceStyle} ref={enabledProfiler.targetRef}>
        <Profiler id="comparison-enabled" onRender={enabledProfiler.onRender}>
          <AIMarkdown
            content={content}
            streaming={running}
            colorScheme={colorScheme}
            config={enabledConfig}
            customComponents={enabledSpy}
          />
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
          <AIMarkdown
            content={content}
            streaming={running}
            colorScheme={colorScheme}
            config={disabledConfig}
            customComponents={disabledSpy}
          />
        </Profiler>
      </div>
      <ProfilerPanel snapshot={disabledProfiler.snapshot} colorScheme={colorScheme} compact />
    </div>
  );

  return (
    <div style={layoutStyle}>
      <div style={buttonRowStyle}>
        {SCENARIO_KEYS.map((key) => (
          <button
            key={key}
            disabled={running}
            onClick={() => setScenario(key)}
            style={scenario === key ? primaryButton : baseButton}
          >
            {scenarios[key].label}
          </button>
        ))}
      </div>

      <div style={buttonRowStyle}>
        <span style={captionStyle}>payload</span>
        {PAYLOAD_SCALES.map((s) => (
          <button
            key={s}
            disabled={running}
            onClick={() => setPayloadScale(s)}
            style={payloadScale === s ? primaryButton : baseButton}
          >
            {s}×
          </button>
        ))}
        <span style={captionStyle}>
          {payloadChars.toLocaleString()} chars / {payloadBlocks} blocks
        </span>
        <span style={{ ...captionStyle, marginLeft: 8 }}>·</span>
        <button
          disabled={running}
          onClick={() => setSpyEnabled((v) => !v)}
          style={baseButton}
          title="Spies count component invocations but add overhead that scales with render count (drags the legacy side more). Turn OFF for the cleanest timing."
        >
          spy: {spyEnabled ? 'ON (component counts)' : 'OFF (clean timing)'}
        </button>
        <button disabled={running} onClick={() => setSwapped((v) => !v)} style={baseButton}>
          ⇄ swap sides
        </button>
      </div>

      <div style={buttonRowStyle}>
        <button onClick={running ? stop : start} style={primaryButton}>
          {running ? 'Stop' : 'Run scenario'}
        </button>
        <button disabled={running} onClick={startMulti} style={baseButton} title="Run the same config 3 times back-to-back to expose run-to-run variance.">
          Run ×3
        </button>
        <button
          onClick={() => {
            stop();
            setContent('');
            enabledProfiler.reset();
            disabledProfiler.reset();
          }}
          style={baseButton}
        >
          Reset
        </button>
      </div>

      <div style={captionStyle}>
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
      />

      <SummaryBanner summary={summary} colorScheme={colorScheme} />

      <div style={splitStyle}>{swapped ? [disabledSide, enabledSide] : [enabledSide, disabledSide]}</div>

      <RunHistory runs={runs} onClear={() => setRuns([])} colorScheme={colorScheme} />
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
 * Noise band for the total-commit delta. Floor of 15 ms (observed swing on
 * an idle machine) or 4% of the larger side's total, whichever is bigger;
 * sharpened to 2×stddev once ≥3 same-config runs exist in history.
 */
function noiseBandMs(enabledTotal: number, disabledTotal: number, sameConfigRuns: RunRecord[]): number {
  const heuristic = Math.max(15, 0.04 * Math.max(enabledTotal, disabledTotal));
  if (sameConfigRuns.length >= 3) {
    return Math.max(heuristic, 2 * stddev(sameConfigRuns.map((r) => r.deltaTotal)));
  }
  return heuristic;
}

export function computeSummary(
  enabled: RenderProfilerSnapshot,
  disabled: RenderProfilerSnapshot,
  spyEnabled: boolean,
  sameConfigRuns: RunRecord[],
  /** True when the two sides run in separate processes (cross-site iframes):
   *  frame/jank signals are then genuinely per-side and get a winner. */
  isolated = false
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

  const deltaStr = (e: number, d: number, digits = 2) => {
    if (!bothActive) return '—';
    const delta = e - d;
    return `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta), digits)}`;
  };

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
      winner: pickWinner(enabled.memoEffectiveness, disabled.memoEffectiveness, false /* higher is better */),
      hint: '(base − actual) / base; how much memoization is saving on each side',
    },
    {
      label: 'element renders',
      enabled: spyEnabled ? String(enabled.elementRenders.total) : 'spy off',
      disabled: spyEnabled ? String(disabled.elementRenders.total) : 'spy off',
      delta:
        bothActive && spyEnabled
          ? `${enabled.elementRenders.total - disabled.elementRenders.total >= 0 ? '+' : '−'}${Math.abs(
              enabled.elementRenders.total - disabled.elementRenders.total
            )}`
          : '—',
      winner: spyEnabled ? pickWinner(enabled.elementRenders.total, disabled.elementRenders.total) : undefined,
      hint: spyEnabled
        ? 'spy customComponents count each invocation; block-memo skips invoking cached subtrees → the cleanest react-scan-style measure. NOTE: the spies themselves add cost proportional to this count, slightly inflating the legacy side’s commit times.'
        : 'spies disabled — clean-timing mode. Re-enable to count component invocations.',
    },
    {
      label: 'DOM mutations',
      enabled: String(enabled.dom.total),
      disabled: String(disabled.dom.total),
      delta: bothActive
        ? `${enabled.dom.total - disabled.dom.total >= 0 ? '+' : '−'}${Math.abs(enabled.dom.total - disabled.dom.total)}`
        : '—',
      // No winner: this metric SHOULD match between the two paths.
      hint: 'expected to match — React’s reconciler already skips DOM for unchanged subtrees in BOTH paths. Block-memo saves the JS decision cost (commit ms), not the DOM op. Treat large divergence as a bug signal.',
    },
    {
      label: 'slow frames (<30fps)',
      enabled: String(enabled.slowFrameCount),
      disabled: String(disabled.slowFrameCount),
      delta: bothActive
        ? `${enabled.slowFrameCount - disabled.slowFrameCount >= 0 ? '+' : '−'}${Math.abs(enabled.slowFrameCount - disabled.slowFrameCount)}`
        : '—',
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
 */
export const VerdictBanner = ({
  summary,
  sameConfigRuns,
  payloadScale,
  payloadChars,
  payloadBlocks,
  spyEnabled,
  colorScheme,
  isolated = false,
}: {
  summary: ComparisonSummary;
  sameConfigRuns: RunRecord[];
  payloadScale: PayloadScale;
  payloadChars: number;
  payloadBlocks: number;
  spyEnabled: boolean;
  colorScheme: ColorScheme;
  isolated?: boolean;
}) => {
  const theme = getStreamingTheme(colorScheme);
  if (!summary.bothActive) return null;

  const d = summary.totalCommitSavingsMs;
  const pct = fmtPct(Math.abs(summary.totalCommitSavingsFraction));
  const noise = fmt(summary.noiseMs, 0);

  let accent = theme.textMuted;
  let headline: string;
  const details: string[] = [];

  if (summary.withinNoise) {
    headline = `两边基本打平：这轮 block-memo ${d >= 0 ? '快' : '慢'}了 ${fmt(Math.abs(d), 1)} ms（${pct}），在本机的运行波动（约 ±${noise} ms）之内 —— 这个差值说明不了谁快谁慢。`;
    if (payloadScale === 1 && payloadChars < 4000) {
      details.push(
        `当前内容只有 ${payloadChars.toLocaleString()} 字符 / ${payloadBlocks} 个块。内容越短，可复用的渲染就越少，而缓存本身的记账成本不变 —— 小文档打平是预期行为，不是坏事。想看真实收益，切到 4× 或 16× payload 再跑。`
      );
    }
  } else if (d > 0) {
    accent = theme.good;
    headline = `block-memo 赢了：整轮少花 ${fmt(d, 1)} ms（省 ${pct}），超出噪音带（±${noise} ms），是真实差距。`;
    if (summary.deltaP95 > 0.5) {
      details.push(`最卡的那 5% 次提交快了 ${fmt(summary.deltaP95, 1)} ms —— 这对应用户能感觉到的卡顿改善。`);
    }
    if (summary.deltaElem !== null && summary.deltaElem > 0) {
      details.push(`组件函数少执行了 ${summary.deltaElem.toLocaleString()} 次（缓存命中的块直接复用上一帧的结果）。`);
    }
  } else {
    accent = theme.bad;
    headline = `这轮 block-memo 确实更慢：多花 ${fmt(Math.abs(d), 1)} ms（${pct}），超出噪音带（±${noise} ms）。`;
    if (payloadScale === 1) {
      details.push(
        `小 payload 下这通常仍是"固定记账成本 > 可省工作量"的体现。先切到 16× 复测：如果大 payload 也稳定为负，才值得当回归去查。`
      );
    } else {
      details.push(`这是大 payload —— 稳定复现的话建议用 Run ×3 确认，然后查最近的热路径改动。`);
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
      ? '组件计数 spy 是开着的：它对渲染次数多的一侧（通常是 legacy）拖累更大，会略微夸大 block-memo 的优势。要最干净的计时，关掉 spy 再跑。'
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
      <div style={{ color: theme.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>
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
};

const SCENARIO_LETTER: Record<ScenarioKey, string> = {
  largeAppend: 'A',
  blockBurst: 'B',
  fastSmall: 'C',
  ultraFast: 'D',
  slowSteady: 'E',
  randomTokens: 'F',
};

/** History of completed runs — makes cross-run comparison a table lookup
 *  instead of a memory exercise. */
export const RunHistory = ({
  runs,
  onClear,
  colorScheme,
}: {
  runs: RunRecord[];
  onClear: () => void;
  colorScheme: ColorScheme;
}) => {
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
        <span style={{ color: theme.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          run history
        </span>
        <span style={{ ...mono, color: theme.textMuted }}>Δ &gt; 0 = block-memo faster</span>
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
            <th style={head}>Δ total (ms)</th>
            <th style={head}>Δ p95 (ms)</th>
            <th style={head}>Δ element renders</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map((r, i) => (
            <tr key={`${r.at}-${i}`}>
              <td style={cell}>{r.at}</td>
              <td style={cell}>{SCENARIO_LETTER[r.scenario]}</td>
              <td style={cell}>
                {r.scale}× ({r.chars.toLocaleString()}c/{r.blocks}b)
              </td>
              <td style={cell}>{r.spy ? 'on' : 'off'}</td>
              <td style={{ ...cell, color: deltaColor(r.deltaTotal) }}>{fmtSigned(r.deltaTotal)}</td>
              <td style={{ ...cell, color: deltaColor(r.deltaP95) }}>{fmtSigned(r.deltaP95)}</td>
              <td style={cell}>{r.deltaElem === null ? '—' : fmtSigned(r.deltaElem, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const SummaryBanner = ({ summary, colorScheme }: { summary: ComparisonSummary; colorScheme: ColorScheme }) => {
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
  const headlineColor = summary.withinNoise
    ? theme.textMuted
    : enabledWins
      ? theme.good
      : theme.bad;

  return (
    <div style={banner}>
      <div style={headlineStyle}>
        <span>Total React commit time saved by block-memo:</span>
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
        <span style={headerCell}>blockMemo on</span>
        <span style={headerCell}>blockMemo off</span>
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
};

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
