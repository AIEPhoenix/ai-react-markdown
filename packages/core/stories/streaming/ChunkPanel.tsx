'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import type { ChunkSample } from './useRenderProfiler';
import { getStreamingTheme, type ColorScheme } from './theme';

export const ChunkPanel = ({ chunks, colorScheme }: { chunks: ChunkSample[]; colorScheme: ColorScheme }) => {
  const tailRef = useRef<HTMLDivElement>(null);
  const theme = getStreamingTheme(colorScheme);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end' });
  }, [chunks.length]);

  const total = chunks.reduce((sum, c) => sum + c.size, 0);

  const wrapStyle: CSSProperties = {
    background: theme.chunkBg,
    border: `1px solid ${theme.chunkBorder}`,
    borderRadius: 8,
    color: theme.chunkText,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 11,
    lineHeight: 1.5,
    maxHeight: 180,
    overflow: 'auto',
    padding: '10px 12px',
  };

  const rowStyle: CSSProperties = {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: '40px 56px 1fr',
  };

  return (
    <div style={wrapStyle}>
      <div style={{ color: theme.chunkMuted, marginBottom: 6 }}>
        chunks: {chunks.length} · total chars: {total}
      </div>
      {chunks.map((c) => (
        <div key={c.index} style={rowStyle}>
          <span style={{ color: theme.chunkIndex }}>#{c.index}</span>
          <span style={{ color: theme.chunkDelay }}>{c.delay}ms</span>
          <span style={{ color: theme.chunkSize, wordBreak: 'break-all' }}>+{c.size}ch</span>
        </div>
      ))}
      <div ref={tailRef} />
    </div>
  );
};
