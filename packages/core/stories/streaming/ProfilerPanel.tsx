'use client';

import type { CSSProperties } from 'react';
import type { ProfilerSnapshot } from './useStreamProfiler';
import { getStreamingTheme, type ColorScheme } from './theme';

const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '—');

interface Field {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad';
}

export const ProfilerPanel = ({
  snapshot,
  colorScheme,
}: {
  snapshot: ProfilerSnapshot;
  colorScheme: ColorScheme;
}) => {
  const theme = getStreamingTheme(colorScheme);

  const gridStyle: CSSProperties = {
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    color: theme.text,
    display: 'grid',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    gap: 8,
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    lineHeight: 1.6,
    padding: 12,
  };

  const fpsTone: Field['tone'] | undefined =
    snapshot.fps >= 55 ? 'good' : snapshot.fps >= 30 ? 'warn' : snapshot.fps > 0 ? 'bad' : undefined;
  const commitTone: Field['tone'] | undefined =
    snapshot.maxCommitMs > 16 ? 'bad' : snapshot.maxCommitMs > 8 ? 'warn' : 'good';

  const toneColor = (tone: Field['tone']) => {
    if (tone === 'good') return theme.good;
    if (tone === 'warn') return theme.warn;
    if (tone === 'bad') return theme.bad;
    return undefined;
  };

  const fields: Field[] = [
    { label: 'commits', value: String(snapshot.commits) },
    { label: 'total chars', value: String(snapshot.totalChars) },
    { label: 'last commit (ms)', value: fmt(snapshot.lastCommitMs) },
    { label: 'avg commit (ms)', value: fmt(snapshot.avgCommitMs) },
    { label: 'max commit (ms)', value: fmt(snapshot.maxCommitMs), tone: commitTone },
    { label: 'fps (now)', value: fmt(snapshot.fps, 0), tone: fpsTone },
    {
      label: 'min fps',
      value: Number.isFinite(snapshot.minFps) ? fmt(snapshot.minFps, 0) : '—',
    },
    {
      label: 'slow frames (<30fps)',
      value: String(snapshot.slowFrameCount),
      tone: snapshot.slowFrameCount > 0 ? 'warn' : 'good',
    },
    { label: 'chunks emitted', value: String(snapshot.chunks.length) },
    { label: 'raf ticks', value: String(snapshot.rafCount) },
  ];

  return (
    <div style={gridStyle}>
      {!snapshot.profilerActive && snapshot.commits === 0 && (
        <div style={{ gridColumn: '1 / -1', color: theme.warn, fontSize: 11 }}>
          ⚠ React.Profiler hasn&apos;t fired yet — confirm your build is dev-mode.
        </div>
      )}
      {fields.map((f) => (
        <div key={f.label}>
          <div style={{ color: theme.textMuted, fontSize: 11 }}>{f.label}</div>
          <div style={{ color: toneColor(f.tone) ?? theme.text, fontSize: 14, fontWeight: 600 }}>
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
};
