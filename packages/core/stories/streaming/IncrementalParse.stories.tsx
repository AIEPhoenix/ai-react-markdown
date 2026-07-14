/**
 * Stateful integration smoke for `config.incrementalParseEnabled`.
 *
 * The splice-equivalence arbiter (`incrementalParse/spliceEquivalence.test.ts`)
 * exhaustively proves parse-level output equality, and byteEquivalence proves
 * one-shot SSR is unperturbed — but neither exercises the REACT wiring
 * (render-phase state ref across rerenders, StrictMode double-invocation, G3
 * interplay). This story streams the benchmark payload into two `<AIMarkdown>`
 * instances that differ ONLY in the flag and asserts, in a real browser via
 * the vitest Storybook project, that their live DOM stays byte-identical on
 * every frame — and that the incremental engine actually engaged (counted via
 * the dev-only `scan` stage channel) rather than silently falling back.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import AIMarkdown from '../../src/index';
import { subscribeStageTimings } from '../../src/components/devStageTimings';
import { computeFreezeBoundary } from '../../src/components/incrementalParse';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { withThemedBackground } from '../decorators';
import { getStreamingTheme } from './theme';
import { DEFAULT_PAYLOAD, withDefs } from './scenarios';
import { codePointSnapshots } from '../../src/components/incrementalParse/codePointSnapshots';
import { useDomEqualityStats } from './useDomEqualityStats';

/** Shared documentId so both sides emit identical clobber-prefixed ids. */
const SMOKE_DOCUMENT_ID = 'ip-smoke';
const CHUNK_CODE_POINTS = 24;
const FRAME_INTERVAL_MS = 15;

const INCREMENTAL_ON = { incrementalParseEnabled: true } as const;
const INCREMENTAL_OFF = { incrementalParseEnabled: false } as const;

interface SmokeStats {
  frames: number;
  mismatches: number;
  scans: number;
  firstMismatchLength: number;
}

function IncrementalParseSmoke({ payload }: { payload: string }) {
  const [content, setContent] = useState('');
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<SmokeStats | null>(null);
  const onRef = useRef<HTMLDivElement>(null);
  const offRef = useRef<HTMLDivElement>(null);
  const scansRef = useRef(0);
  const { statsRef } = useDomEqualityStats(onRef, offRef, content);

  // Count `scan` stage emissions — the incremental engine is the only
  // caller, so scans > 0 proves the flag-on side routed through it.
  useEffect(
    () =>
      subscribeStageTimings((stage) => {
        if (stage === 'scan') scansRef.current += 1;
      }),
    []
  );

  useEffect(() => {
    const snapshots = codePointSnapshots(payload, CHUNK_CODE_POINTS);
    let idx = 0;
    const timer = setInterval(() => {
      setContent(snapshots[idx]);
      if (idx === snapshots.length - 1) {
        setDone(true);
        clearInterval(timer);
      }
      idx += 1;
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [payload]);

  // Final mirror only — the play assertion reads the data attributes.
  useEffect(() => {
    if (done) setFinalStats({ ...statsRef.current, scans: scansRef.current });
  }, [content, done, statsRef]);

  return (
    <div>
      <div
        data-testid="ip-smoke-summary"
        data-done={finalStats ? 'true' : 'false'}
        data-frames={finalStats?.frames ?? 0}
        data-mismatches={finalStats?.mismatches ?? 0}
        data-scans={finalStats?.scans ?? 0}
        data-first-mismatch-length={finalStats?.firstMismatchLength ?? -1}
        style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}
      >
        {finalStats
          ? `done — frames=${finalStats.frames} mismatches=${finalStats.mismatches} scans=${finalStats.scans}`
          : `streaming… ${content.length}/${payload.length}`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div ref={onRef} data-testid="ip-smoke-on">
          <AIMarkdown content={content} streaming={!done} documentId={SMOKE_DOCUMENT_ID} config={INCREMENTAL_ON} />
        </div>
        <div ref={offRef} data-testid="ip-smoke-off">
          <AIMarkdown content={content} streaming={!done} documentId={SMOKE_DOCUMENT_ID} config={INCREMENTAL_OFF} />
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive verification playground: streams arbitrary markdown into a
 * flag-on / flag-off pair while visualizing what the incremental engine is
 * doing — the freeze boundary's live position (frozen vs active fraction of
 * the source), the per-frame DOM-equality verdict, and the `scan` stage
 * count proving the engine engaged. Use it to eyeball a suspicious payload:
 * paste it into `content`, watch the bar, and read the mismatch counter.
 */
function IncrementalParsePlayground(props: {
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
        if (stage === 'scan' && instanceId === SMOKE_DOCUMENT_ID) scansRef.current += 1;
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
          <div style={{ ...mono, color: theme.textMuted, marginBottom: 6 }}>incrementalParseEnabled: true</div>
          <div ref={onRef} style={pane}>
            <AIMarkdown
              content={content}
              streaming={!done}
              documentId={SMOKE_DOCUMENT_ID}
              config={INCREMENTAL_ON}
              colorScheme={colorScheme}
            />
          </div>
        </div>
        <div>
          <div style={{ ...mono, color: theme.textMuted, marginBottom: 6 }}>incrementalParseEnabled: false</div>
          <div ref={offRef} style={pane}>
            <AIMarkdown
              content={content}
              streaming={!done}
              documentId={SMOKE_DOCUMENT_ID}
              config={INCREMENTAL_OFF}
              colorScheme={colorScheme}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof IncrementalParseSmoke> = {
  title: 'Core/Streaming/IncrementalParse',
  component: IncrementalParseSmoke,
  decorators: [withThemedBackground],
  parameters: {
    // Live DOM comparison harness — snapshotting the mid-stream markup is
    // meaningless and flaky by construction.
    chromatic: { disableSnapshot: true },
  },
};
export default meta;

type Story = StoryObj<typeof IncrementalParseSmoke>;

export const VerificationPlayground: StoryObj<typeof IncrementalParsePlayground> = {
  args: {
    content: withDefs(DEFAULT_PAYLOAD),
    chunkSize: 16,
    intervalMs: 30,
  },
  argTypes: {
    content: { control: 'text', description: 'Markdown streamed into both panes. Paste suspicious payloads here.' },
    chunkSize: { control: { type: 'number', min: 1, max: 200 }, description: 'Code points appended per tick.' },
    intervalMs: { control: { type: 'number', min: 5, max: 500 }, description: 'Milliseconds between ticks.' },
    colorScheme: { table: { disable: true } },
  },
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: true } },
  render: (args, context) => (
    <IncrementalParsePlayground
      content={args.content ?? DEFAULT_PAYLOAD}
      chunkSize={args.chunkSize ?? 16}
      intervalMs={args.intervalMs ?? 30}
      colorScheme={context.globals.theme === 'dark' ? 'dark' : 'light'}
    />
  ),
};

const smokePlay: Story['play'] = async ({ canvasElement }) => {
  const summary = await waitFor(
    () => {
      const el = canvasElement.querySelector('[data-testid="ip-smoke-summary"]');
      if (!el || el.getAttribute('data-done') !== 'true') throw new Error('streaming not finished yet');
      return el;
    },
    { timeout: 20_000 }
  );
  const frames = Number(summary.getAttribute('data-frames'));
  const mismatches = Number(summary.getAttribute('data-mismatches'));
  const scans = Number(summary.getAttribute('data-scans'));
  expect(
    mismatches,
    `flag-on DOM diverged from flag-off (first at content length ${summary.getAttribute('data-first-mismatch-length')})`
  ).toBe(0);
  expect(frames).toBeGreaterThan(10);
  // The incremental engine must have actually engaged — a silent
  // permanent fallback would make the mismatch assertion vacuous.
  expect(scans).toBeGreaterThan(0);
};

export const StreamingSmoke: Story = {
  render: () => <IncrementalParseSmoke payload={DEFAULT_PAYLOAD} />,
  play: smokePlay,
};

/** Footnote-bearing payload through the REACT wiring — the v2 injection
 *  replay's footer regeneration, clobber-prefixed fn/fnref ids, and backref
 *  counts must all survive StrictMode double-render and the G3 interplay,
 *  not just the node-level arbiter. */
export const StreamingSmokeWithFootnotes: Story = {
  render: () => <IncrementalParseSmoke payload={withDefs(DEFAULT_PAYLOAD)} />,
  play: smokePlay,
};
