import React, { useEffect, useMemo, useRef, useState } from 'react';
import AIMarkdown from '../../src/index';
import { computeFreezeBoundary, codePointSnapshots, subscribeStageTimings } from '@ai-react-markdown/engine';
import { getStreamingTheme } from './theme';
import { useDomEqualityStats } from './useDomEqualityStats';

/** Both panes share one documentId so their clobber-prefixed ids match and the
 *  DOM comparison needs no normalization. */
const PLAYGROUND_DOCUMENT_ID = 'ip-playground';

const INCREMENTAL_ON = { incrementalParse: true } as const;
const INCREMENTAL_OFF = { incrementalParse: false } as const;

/**
 * Interactive verification playground: streams arbitrary markdown into a
 * flag-on / flag-off pair while visualizing what the incremental engine is
 * doing — the freeze boundary's live position (frozen vs active fraction of
 * the source), the per-frame DOM-equality verdict, and the `scan` stage
 * count proving the engine engaged. Use it to eyeball a suspicious payload:
 * paste it into `content`, watch the bar, and read the mismatch counter.
 */
export function IncrementalParsePlayground(props: {
  content: string;
  chunkSize: number;
  intervalMs: number;
  colorScheme: 'light' | 'dark';
}) {
  // Restart = REMOUNT of the streaming run (key bump) — resetting run state
  // in an effect would be a sync-setState-in-effect lint violation, and a
  // fresh mount is the honest semantics anyway (fresh engine state ref).
  const [generation, setGeneration] = useState(0);
  return (
    <PlaygroundRun
      key={`${generation}:${props.chunkSize}:${props.intervalMs}:${props.content}`}
      onRestart={() => setGeneration((g) => g + 1)}
      {...props}
    />
  );
}

function PlaygroundRun({
  content: payload,
  chunkSize,
  intervalMs,
  colorScheme,
  onRestart,
}: {
  content: string;
  chunkSize: number;
  intervalMs: number;
  colorScheme: 'light' | 'dark';
  onRestart: () => void;
}) {
  const theme = getStreamingTheme(colorScheme);
  const [content, setContent] = useState('');
  const [done, setDone] = useState(false);
  const onRef = useRef<HTMLDivElement>(null);
  const offRef = useRef<HTMLDivElement>(null);
  const scansRef = useRef(0);
  const { statsRef } = useDomEqualityStats(onRef, offRef, content);
  // Render-facing mirror (react-hooks forbids reading refs in render).
  const [stats, setStats] = useState({ frames: 0, mismatches: 0, scans: 0, firstMismatchLength: -1 });

  useEffect(
    () =>
      subscribeStageTimings((stage, _ms, instanceId) => {
        if (stage === 'scan' && instanceId === PLAYGROUND_DOCUMENT_ID) scansRef.current += 1;
      }),
    []
  );

  useEffect(() => {
    const snapshots = codePointSnapshots(payload, Math.max(1, chunkSize));
    let idx = 0;
    const timer = setInterval(
      () => {
        setContent(snapshots[idx]);
        if (idx === snapshots.length - 1) {
          setDone(true);
          clearInterval(timer);
        }
        idx += 1;
      },
      Math.max(5, intervalMs)
    );
    return () => clearInterval(timer);
  }, [payload, chunkSize, intervalMs]);

  useEffect(() => {
    // Throttled mirror (every 4th frame + final) — a per-frame setState
    // would double this component's render count for a counters-only UI.
    const s = statsRef.current;
    if (done || s.frames % 4 === 0) setStats({ ...s, scans: scansRef.current });
  }, [content, done, statsRef]);

  // Mirror the ENGINE's boundary. Since v2 footnotes SPLICE (injection
  // replay) — the default payload's footnote tail no longer flips the bar
  // to a fallback; the reference taint just holds the boundary below any
  // unresolved `[^x]` until its def settles.
  // Memoized: the stats-mirror state update below re-renders this
  // component, and an unmemoized scan would run the whole-document pass
  // twice per streamed tick — the visualizer distorting the number it
  // exists to show (review finding E6).
  const scan = useMemo(() => (content ? computeFreezeBoundary(content, { defListEnabled: true }) : null), [content]);
  const boundary = scan ? scan.boundary : 0;
  const frozenPct = content.length > 0 ? boundary / content.length : 0;
  const streamedPct = payload.length > 0 ? content.length / payload.length : 0;
  const equalityColor = stats.mismatches === 0 ? theme.good : theme.bad;

  const mono: React.CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    color: theme.text,
  };
  const barOuter: React.CSSProperties = {
    position: 'relative',
    height: 14,
    borderRadius: 7,
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    overflow: 'hidden',
  };
  const pane: React.CSSProperties = {
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    padding: 12,
    maxHeight: 420,
    overflow: 'auto',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={onRestart} style={{ ...mono, padding: '4px 10px' }}>
          ↻ restart stream
        </button>
        <span style={mono}>
          streamed {content.length}/{payload.length}
        </span>
        <span style={{ ...mono, color: theme.good }}>
          frozen {(frozenPct * 100).toFixed(0)}% (offset {boundary})
        </span>
        <span style={mono}>scans {stats.scans}</span>
        <span style={{ ...mono, color: equalityColor }}>
          equality: {stats.frames} frames / {stats.mismatches} mismatches
          {done && stats.mismatches === 0 && ' ✓'}
          {stats.mismatches > 0 && ` ✗ first at length ${stats.firstMismatchLength}`}
        </span>
      </div>
      {/* Freeze-boundary bar: green = frozen prefix (parsed once, reused),
          amber = active tail (re-parsed each frame), track = not yet streamed. */}
      <div style={barOuter} title="green: frozen prefix · amber: active tail · empty: not yet streamed">
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${streamedPct * 100}%`,
            background: theme.warn,
            opacity: 0.55,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${streamedPct * frozenPct * 100}%`,
            background: theme.good,
          }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ ...mono, color: theme.textMuted, marginBottom: 6 }}>incrementalParse: true</div>
          <div ref={onRef} style={pane}>
            <AIMarkdown
              content={content}
              streaming={!done}
              documentId={PLAYGROUND_DOCUMENT_ID}
              {...INCREMENTAL_ON}
              colorScheme={colorScheme}
            />
          </div>
        </div>
        <div>
          <div style={{ ...mono, color: theme.textMuted, marginBottom: 6 }}>incrementalParse: false</div>
          <div ref={offRef} style={pane}>
            <AIMarkdown
              content={content}
              streaming={!done}
              documentId={PLAYGROUND_DOCUMENT_ID}
              {...INCREMENTAL_OFF}
              colorScheme={colorScheme}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
