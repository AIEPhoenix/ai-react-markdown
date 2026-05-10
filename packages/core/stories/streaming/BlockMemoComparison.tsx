'use client';

import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import AIMarkdown from '../../src/index';
import { buildScenarios, DEFAULT_PAYLOAD, SCENARIO_KEYS, type ScenarioKey } from './scenarios';
import { useRenderProfiler, type RenderProfilerSnapshot } from './useRenderProfiler';
import { ProfilerPanel } from './ProfilerPanel';
import { createSpyComponents } from './spyComponents';
import { getStreamingTheme, type ColorScheme } from './theme';

interface BlockMemoComparisonProps {
  colorScheme: ColorScheme;
  initialScenario?: ScenarioKey;
  /** Run the initial scenario automatically on mount. Default true. */
  autoStart?: boolean;
  /** Markdown payload used by every scenario. Falls back to DEFAULT_PAYLOAD. */
  payload?: string;
}

const fmt = (n: number, digits = 2) => (Number.isFinite(n) && !Number.isNaN(n) ? n.toFixed(digits) : '—');

const fmtPct = (n: number) => (Number.isFinite(n) && !Number.isNaN(n) ? `${(n * 100).toFixed(1)}%` : '—');

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
 * The summary banner reports the most informative deltas. The full
 * per-side panels show everything.
 *
 * Caveats (read these before drawing conclusions):
 * - Storybook runs a dev build of React. Absolute numbers are inflated;
 *   trust the ratio between the two columns, not absolute values.
 * - Long tasks are page-wide — both sides will see identical counts.
 * - First 3 commits per side are excluded from stats as JIT warm-up.
 */
export const BlockMemoComparison = ({
  colorScheme,
  initialScenario = 'randomTokens',
  autoStart = true,
  payload = DEFAULT_PAYLOAD,
}: BlockMemoComparisonProps) => {
  const scenarios = useMemo(() => buildScenarios(payload), [payload]);
  const [scenario, setScenario] = useState<ScenarioKey>(initialScenario);
  const [content, setContent] = useState('');
  const [running, setRunning] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const enabledProfiler = useRenderProfiler<HTMLDivElement>({ running });
  const disabledProfiler = useRenderProfiler<HTMLDivElement>({ running });
  const theme = getStreamingTheme(colorScheme);

  const stop = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    cancelRef.current?.();
    setContent('');
    enabledProfiler.reset();
    disabledProfiler.reset();
    setRunning(true);

    const push = (chunk: string) => {
      enabledProfiler.recordChunk(chunk);
      disabledProfiler.recordChunk(chunk);
      setContent((prev) => prev + chunk);
    };
    const done = () => setRunning(false);

    cancelRef.current = scenarios[scenario].run(push, done);
  }, [scenario, scenarios, enabledProfiler, disabledProfiler]);

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
  const enabledSpy = useMemo(
    () => createSpyComponents(enabledProfiler.recordElementRender),
    [enabledProfiler.recordElementRender]
  );
  const disabledSpy = useMemo(
    () => createSpyComponents(disabledProfiler.recordElementRender),
    [disabledProfiler.recordElementRender]
  );

  const summary = computeSummary(enabledProfiler.snapshot, disabledProfiler.snapshot);
  const scenarioConfig = scenarios[scenario];

  const layoutStyle: CSSProperties = {
    color: theme.text,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 12,
  };
  const buttonRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };
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
  };

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
        <button onClick={running ? stop : start} style={primaryButton}>
          {running ? 'Stop' : 'Run scenario'}
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

      <SummaryBanner summary={summary} colorScheme={colorScheme} />

      <div style={splitStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
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
      </div>
    </div>
  );
};

interface ComparisonSummary {
  stats: SummaryStat[];
  totalCommitSavingsMs: number;
  totalCommitSavingsFraction: number;
  /** True once both sides have at least one post-warmup commit. */
  bothActive: boolean;
}

function computeSummary(enabled: RenderProfilerSnapshot, disabled: RenderProfilerSnapshot): ComparisonSummary {
  const bothActive = enabled.actual.count > 0 && disabled.actual.count > 0;
  const totalDelta = disabled.actual.total - enabled.actual.total;
  const totalFraction = disabled.actual.total > 0 ? totalDelta / disabled.actual.total : 0;

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
      winner: pickWinner(enabled.actual.total, disabled.actual.total),
      hint: 'cumulative React work over the whole run',
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
      enabled: String(enabled.elementRenders.total),
      disabled: String(disabled.elementRenders.total),
      delta: bothActive
        ? `${enabled.elementRenders.total - disabled.elementRenders.total >= 0 ? '+' : '−'}${Math.abs(
            enabled.elementRenders.total - disabled.elementRenders.total
          )}`
        : '—',
      winner: pickWinner(enabled.elementRenders.total, disabled.elementRenders.total),
      hint: 'spy customComponents count each invocation; block-memo skips invoking cached subtrees → the cleanest react-scan-style measure',
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
      // No winner: rAF is page-wide, two side-by-side profilers will
      // observe near-identical frame cadence. See the per-side panel for
      // long-task count if that's the question you actually have.
      hint: 'PAGE-WIDE (rAF is per page, not per Profiler boundary). Expected to match. Treat as a scenario-level jank indicator.',
    },
  ];

  return {
    stats,
    totalCommitSavingsMs: totalDelta,
    totalCommitSavingsFraction: totalFraction,
    bothActive,
  };
}

const SummaryBanner = ({ summary, colorScheme }: { summary: ComparisonSummary; colorScheme: ColorScheme }) => {
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
  const headlineColor = enabledWins ? theme.good : summary.totalCommitSavingsMs < 0 ? theme.bad : theme.text;

  return (
    <div style={banner}>
      <div style={headlineStyle}>
        <span>Total React commit time saved by block-memo:</span>
        <span style={{ ...headlineValueStyle, color: headlineColor }}>
          {summary.totalCommitSavingsMs >= 0 ? '+' : '−'}
          {fmt(Math.abs(summary.totalCommitSavingsMs), 1)} ms
        </span>
        <span style={{ color: theme.textMuted }}>
          ({enabledWins ? 'saved' : 'lost'} {fractionStr} of total commit time)
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
