'use client';

import type { CSSProperties, ReactNode } from 'react';
import { PIPELINE_STAGES } from '@ai-react-markdown/engine';
import type { RenderProfilerSnapshot } from './useRenderProfiler';
import { getStreamingTheme, type ColorScheme } from './theme';

const fmt = (n: number, digits = 2) => (Number.isFinite(n) && !Number.isNaN(n) ? n.toFixed(digits) : '—');
const fmtPct = (n: number) => (Number.isFinite(n) && !Number.isNaN(n) ? `${(n * 100).toFixed(1)}%` : '—');

function topTags(byTag: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(byTag)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/** Panel fields for the observed pipeline stages, in pipeline order. Empty
 *  when this profiler doesn't observe stage measures (legacy side). */
function stageFields(snapshot: RenderProfilerSnapshot): Field[] {
  return PIPELINE_STAGES.filter((k) => snapshot.stages[k]).map((k) => ({
    label: `${k} avg (ms)`,
    value: fmt(snapshot.stages[k].total / snapshot.stages[k].count),
    sub: `Σ ${fmt(snapshot.stages[k].total, 0)} ms · ×${snapshot.stages[k].count} · max ${fmt(snapshot.stages[k].max, 1)}`,
  }));
}

type Tone = 'good' | 'warn' | 'bad';

interface Field {
  label: string;
  value: ReactNode;
  tone?: Tone;
  /** Smaller secondary text under the main value. */
  sub?: string;
}

interface Section {
  title: string;
  hint?: string;
  fields: Field[];
}

export const ProfilerPanel = ({
  snapshot,
  colorScheme,
  compact = false,
}: {
  snapshot: RenderProfilerSnapshot;
  colorScheme: ColorScheme;
  /** Hide secondary fields (min/raf/total chars/…) to fit narrow columns. */
  compact?: boolean;
}) => {
  const theme = getStreamingTheme(colorScheme);
  const stages = stageFields(snapshot);

  const sectionStyle: CSSProperties = {
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    color: theme.text,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    gap: 8,
    padding: 12,
  };
  const sectionTitleStyle: CSSProperties = {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    margin: 0,
    textTransform: 'uppercase',
  };
  const sectionHintStyle: CSSProperties = {
    color: theme.textMuted,
    fontSize: 10,
    marginTop: -4,
  };
  const gridStyle: CSSProperties = {
    display: 'grid',
    fontSize: 12,
    gap: 8,
    gridTemplateColumns: compact ? 'repeat(auto-fill, minmax(96px, 1fr))' : 'repeat(auto-fill, minmax(116px, 1fr))',
    lineHeight: 1.5,
  };

  const fpsTone: Tone | undefined =
    snapshot.fps >= 55 ? 'good' : snapshot.fps >= 30 ? 'warn' : snapshot.fps > 0 ? 'bad' : undefined;
  const p95Tone: Tone | undefined = snapshot.actual.p95 > 16 ? 'bad' : snapshot.actual.p95 > 8 ? 'warn' : 'good';
  const longTaskTone: Tone | undefined =
    snapshot.longTasks.count > 0 ? (snapshot.longTasks.max > 200 ? 'bad' : 'warn') : 'good';
  const slowFrameTone: Tone | undefined = snapshot.slowFrameCount > 0 ? 'warn' : 'good';

  // Tone scale chosen so the legacy/disabled side (which sees ~0–5% from
  // React's own internal memo) renders as neutral, not "warn yellow",
  // which would falsely suggest block-memo is partially active when off.
  const memoTone: Tone | undefined =
    snapshot.actual.count === 0
      ? undefined
      : snapshot.memoEffectiveness > 0.2
        ? 'good'
        : snapshot.memoEffectiveness > 0.05
          ? 'warn'
          : undefined;

  const sections: Section[] = [
    {
      title: 'React commits',
      hint: `excluded first ${snapshot.warmUpCommits} commits as warm-up`,
      fields: [
        { label: 'commits', value: String(snapshot.actual.count) },
        { label: 'p50 actual (ms)', value: fmt(snapshot.actual.p50) },
        { label: 'p95 actual (ms)', value: fmt(snapshot.actual.p95), tone: p95Tone },
        { label: 'p99 actual (ms)', value: fmt(snapshot.actual.p99) },
        { label: 'max actual (ms)', value: fmt(snapshot.actual.max) },
        { label: 'last actual (ms)', value: fmt(snapshot.actual.last) },
        ...(compact
          ? []
          : [
              { label: 'total actual (ms)', value: fmt(snapshot.actual.total, 1) },
              { label: 'avg actual (ms)', value: fmt(snapshot.actual.avg) },
              { label: 'min actual (ms)', value: fmt(snapshot.actual.min) },
            ]),
      ],
    },
    {
      title: 'Memoization (actual vs base)',
      hint: 'base = React’s estimate without memoization',
      fields: [
        {
          label: 'memo effectiveness',
          value: fmtPct(snapshot.memoEffectiveness),
          tone: memoTone,
          sub: `${fmt(snapshot.actual.total, 1)} / ${fmt(snapshot.base.total, 1)} ms`,
        },
        { label: 'p95 base (ms)', value: fmt(snapshot.base.p95) },
        { label: 'avg base (ms)', value: fmt(snapshot.base.avg) },
        { label: 'max base (ms)', value: fmt(snapshot.base.max) },
      ],
    },
    // Pipeline stage timings — present only when this profiler observes the
    // dev-only `ai-markdown:stage:*` measures (block-memo side). Ordered by
    // the shared PIPELINE_STAGES tuple so a stage added to the pipeline
    // cannot be silently omitted from the panel.
    ...(stages.length === 0
      ? []
      : [
          {
            title: 'Pipeline stages (dev-only)',
            hint: 'per-execution timings from ai-markdown:stage:* performance measures, emitted by the block-memo path only. parse + transform run on every content change (with incrementalParse they cover the TAIL only on spliced frames — a scan row appears when the engine is engaged); render is where block-memo saves. render also fires on cache-hit-only re-renders, so its avg skews low by design.',
            fields: stages,
          },
        ]),
    {
      title: 'Component renders',
      hint: 'spy customComponents count function-body invocations per tag (react-scan-style). Block-memo skips re-invoking components inside cached subtrees → totals diverge cleanly between paths.',
      fields: [
        { label: 'total', value: String(snapshot.elementRenders.total) },
        ...topTags(snapshot.elementRenders.byTag, compact ? 4 : 8).map(([tag, n]) => ({
          label: tag,
          value: String(n),
        })),
      ],
    },
    {
      title: 'DOM mutations',
      hint: 'observed via MutationObserver — should match between block-memo on/off. React already skips DOM ops for unchanged subtrees in BOTH paths; block-memo saves the JS work to *decide* (visible as `Component renders` divergence + lower `actual` commit ms), not the DOM op itself. Sanity check, not comparator.',
      fields: [
        { label: 'total', value: String(snapshot.dom.total) },
        { label: 'added', value: String(snapshot.dom.childListAdds) },
        { label: 'removed', value: String(snapshot.dom.childListRemoves) },
        { label: 'attribute', value: String(snapshot.dom.attributes) },
        { label: 'character data', value: String(snapshot.dom.characterData) },
      ],
    },
    {
      title: 'Frames & jank',
      hint: 'fps / slow frames via rAF AND long task ≥ 50 ms via PerformanceObserver — both are PAGE-WIDE signals. Two side-by-side profilers will show identical or near-identical numbers. Use these for "did this scenario jank at all?", not for cross-side attribution.',
      fields: [
        { label: 'fps (now)', value: fmt(snapshot.fps, 0), tone: fpsTone },
        {
          label: 'min fps',
          value: Number.isFinite(snapshot.minFps) ? fmt(snapshot.minFps, 0) : '—',
        },
        { label: 'slow frames', value: String(snapshot.slowFrameCount), tone: slowFrameTone },
        { label: 'long tasks', value: String(snapshot.longTasks.count), tone: longTaskTone },
        { label: 'longest task (ms)', value: fmt(snapshot.longTasks.max, 0) },
        { label: 'total blocked (ms)', value: fmt(snapshot.longTasks.total, 0) },
        ...(compact ? [] : [{ label: 'raf ticks', value: String(snapshot.rafCount) }]),
      ],
    },
    ...(compact
      ? []
      : [
          {
            title: 'Stream',
            fields: [
              { label: 'chunks emitted', value: String(snapshot.chunks.length) },
              { label: 'total chars', value: String(snapshot.totalChars) },
            ],
          },
        ]),
  ];

  const toneColor = (tone: Tone | undefined) => {
    if (tone === 'good') return theme.good;
    if (tone === 'warn') return theme.warn;
    if (tone === 'bad') return theme.bad;
    return undefined;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!snapshot.profilerActive && snapshot.actual.count === 0 && snapshot.warmUpCommits === 0 && (
        <div
          style={{
            color: theme.warn,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 11,
          }}
        >
          ⚠ React.Profiler hasn&apos;t fired yet — confirm your build is dev-mode.
        </div>
      )}
      {sections.map((section) => (
        <section key={section.title} style={sectionStyle}>
          <h5 style={sectionTitleStyle}>{section.title}</h5>
          {section.hint && <div style={sectionHintStyle}>{section.hint}</div>}
          <div style={gridStyle}>
            {section.fields.map((f) => (
              <div key={f.label}>
                <div style={{ color: theme.textMuted, fontSize: 11 }}>{f.label}</div>
                <div
                  style={{
                    color: toneColor(f.tone) ?? theme.text,
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {f.value}
                </div>
                {f.sub && <div style={{ color: theme.textMuted, fontSize: 10 }}>{f.sub}</div>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
