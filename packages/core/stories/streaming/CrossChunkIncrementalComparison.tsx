'use client';

import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import AIMarkdown from '../../src/index';
import { AIMarkdownDocuments } from '../../src/components/AIMarkdownDocuments';
import { DEFAULT_PAYLOAD, type ScenarioKey } from './scenarios';
import { useRenderProfiler } from './useRenderProfiler';
import { ProfilerPanel } from './ProfilerPanel';
import { controlStyles, getStreamingTheme, thinScrollbar, type ColorScheme } from './theme';
import { useComparisonRuns } from './useComparisonRuns';
import { normalizeClobberPrefix, useDomEqualityStats } from './useDomEqualityStats';
import { buildChunkSources, CHUNK_COUNT, sliceChunkContents } from './crossChunkFixtures';

/**
 * Cross-chunk (coordinated) A/B for `incrementalParse` — each side is
 * an `<AIMarkdownDocuments>` document rendered as THREE chunks sharing one
 * documentId, streamed sequentially. The only config difference between the
 * sides is the flag.
 *
 * What this exercises beyond `IncrementalParseComparison`:
 * - phantom-suffix churn: chunk 2/3 reference labels DEFINED in chunk 1, so
 *   their parse inputs carry a registry-driven phantom suffix that appears/
 *   changes mid-stream (v1 excluded coordinated mode for exactly this);
 * - registry version bumps → equal-content re-renders (the engine's
 *   zero-scan short-circuit + suffix-only re-parse paths);
 * - the aggregate footnote footer on the last chunk (built from harvested
 *   `bodyHast` — which the splice's replay-regenerated footer must feed
 *   correctly).
 *
 * Verification mirrors the standalone comparison: per-frame DOM equality
 * between the sides (clobber prefixes normalized — the sides intentionally
 * use different documentIds to scope the stage channel). Mismatches must be
 * 0; a non-zero count is a shipping bug.
 */

const ON_DOC_ID = 'xckc-on';
const OFF_DOC_ID = 'xckc-off';
// v2 flat props: both sides run block-memo; only the incremental switch differs.
const ON_CONFIG = { incrementalParse: true } as const;
const OFF_CONFIG = { incrementalParse: false } as const;
const PIPELINE_STAGES_SHOWN = ['scan', 'parse', 'transform'] as const;
const fmt = (n: number, digits = 1) => (Number.isFinite(n) && !Number.isNaN(n) ? n.toFixed(digits) : '—');

function pipelineTotal(stages: Record<string, { total: number }>): number {
  return PIPELINE_STAGES_SHOWN.reduce((sum, key) => sum + (stages[key]?.total ?? 0), 0);
}

/** One side: the coordinated document, chunk contents derived from the
 *  global stream cursor (chunks fill sequentially, like an LLM emitting a
 *  long answer split across message parts). */
function CoordinatedSide({
  docId,
  config,
  chunkContents,
  running,
  colorScheme,
  domRef,
}: {
  docId: string;
  config: typeof ON_CONFIG | typeof OFF_CONFIG;
  chunkContents: string[];
  running: boolean;
  colorScheme: ColorScheme;
  domRef: React.RefObject<HTMLDivElement | null>;
}) {
  const theme = getStreamingTheme(colorScheme);
  const box: CSSProperties = {
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    padding: 12,
    maxHeight: 380,
    overflow: 'auto',
    ...thinScrollbar,
  };
  return (
    <div ref={domRef} style={box}>
      <AIMarkdownDocuments>
        {chunkContents.map((chunk, i) => (
          <AIMarkdown
            key={i}
            content={chunk}
            streaming={running}
            documentId={docId}
            blockMemo={true}
            incrementalParse={config.incrementalParse}
            colorScheme={colorScheme}
          />
        ))}
      </AIMarkdownDocuments>
    </div>
  );
}

export const CrossChunkIncrementalComparison = ({
  colorScheme,
  initialScenario = 'randomTokens',
  autoStart = true,
  payload = DEFAULT_PAYLOAD,
}: {
  colorScheme: ColorScheme;
  initialScenario?: ScenarioKey;
  autoStart?: boolean;
  payload?: string;
}) => {
  const [content, setContent] = useState('');
  const [running, setRunning] = useState(false);
  const theme = getStreamingTheme(colorScheme);
  const controls = controlStyles(theme);

  // Decorate-then-join: the hook streams the JOINED document, so the
  // streamed length always covers every chunk source byte (length
  // conservation — chunk contents are cursor slices of the sources). The
  // payload-scale toggle is intentionally absent here: scaling would have
  // to re-derive the chunk layout mid-history and pollute run records.
  const chunkSources = useMemo(() => buildChunkSources(payload), [payload]);
  const fullDocument = useMemo(() => chunkSources.join(''), [chunkSources]);

  const onProfiler = useRenderProfiler<HTMLDivElement>({ running, observeStages: true, stageInstanceId: ON_DOC_ID });
  const offProfiler = useRenderProfiler<HTMLDivElement>({ running, observeStages: true, stageInstanceId: OFF_DOC_ID });

  const onDomRef = useRef<HTMLDivElement>(null);
  const offDomRef = useRef<HTMLDivElement>(null);
  const normalize = useCallback(
    (html: string, side: 'on' | 'off') => normalizeClobberPrefix(html, side === 'on' ? ON_DOC_ID : OFF_DOC_ID),
    []
  );
  const { statsRef: equalityRef, reset: resetEquality } = useDomEqualityStats(onDomRef, offDomRef, content, normalize);
  const [equality, setEquality] = useState({ frames: 0, mismatches: 0, firstMismatchLength: -1 });

  const begin = useCallback(() => {
    setContent('');
    resetEquality();
    setEquality({ frames: 0, mismatches: 0, firstMismatchLength: -1 });
    onProfiler.reset();
    offProfiler.reset();
  }, [onProfiler, offProfiler, resetEquality]);
  const push = useCallback(
    (chunk: string) => {
      onProfiler.recordChunk(chunk);
      offProfiler.recordChunk(chunk);
      setContent((prev) => prev + chunk);
    },
    [onProfiler, offProfiler]
  );

  const {
    scenario,
    setScenario,
    setSpyEnabled,
    setIncrementalEnabled,
    sameConfigRuns,
    clearRuns,
    payloadChars,
    scenarios,
    start,
    startMulti,
    stop,
    busy,
  } = useComparisonRuns({
    payload: fullDocument,
    initialScenario,
    running,
    setRunning,
    enabledSnapshot: onProfiler.snapshot,
    disabledSnapshot: offProfiler.snapshot,
    begin,
    push,
  });

  useEffect(() => {
    setIncrementalEnabled(true);
    setSpyEnabled(false);
  }, [setIncrementalEnabled, setSpyEnabled]);

  useEffect(() => {
    if (!autoStart) return;
    start();
    // Unmount cancellation lives in useComparisonRuns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) setEquality({ ...equalityRef.current });
  }, [content, running, equalityRef]);

  const chunkContents = useMemo(() => sliceChunkContents(chunkSources, content.length), [chunkSources, content.length]);

  const onStages = onProfiler.snapshot.stages;
  const offStages = offProfiler.snapshot.stages;
  const onPipelineMs = pipelineTotal(onStages);
  const offPipelineMs = pipelineTotal(offStages);
  const pipelineSaving = offPipelineMs > 0 ? 1 - onPipelineMs / offPipelineMs : 0;
  const commitDelta = offProfiler.snapshot.actual.total - onProfiler.snapshot.actual.total;

  const mono: CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    color: theme.text,
  };
  const panel: CSSProperties = {
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };
  const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };

  const equalityDone = !running && equality.frames > 0;
  const equalityColor = equality.mismatches === 0 ? theme.good : theme.bad;
  const scanCount = onStages['scan']?.count ?? 0;

  const stageRow = (label: string, stages: Record<string, { count: number; total: number }>) => (
    <div style={{ ...mono, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <span style={{ color: theme.textMuted, minWidth: 118 }}>{label}</span>
      {PIPELINE_STAGES_SHOWN.map((key) => (
        <span key={key}>
          {key}: {fmt(stages[key]?.total ?? 0)} ms ×{stages[key]?.count ?? 0}
        </span>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={controls.buttonRow}>
        <span style={controls.caption}>scenario</span>
        {Object.entries(scenarios).map(([key, s]) => (
          <button
            key={key}
            disabled={busy}
            onClick={() => setScenario(key as ScenarioKey)}
            style={scenario === key ? controls.primaryButton : controls.baseButton}
            title={s.description}
          >
            {key}
          </button>
        ))}
        <span style={controls.caption}>
          {payloadChars.toLocaleString()} chars / {CHUNK_COUNT} chunks per side
        </span>
      </div>

      <div style={controls.buttonRow}>
        <button onClick={running ? stop : start} style={controls.primaryButton}>
          {running ? 'Stop' : 'Run scenario'}
        </button>
        <button disabled={busy} onClick={startMulti} style={controls.baseButton}>
          Run ×3
        </button>
        <button disabled={busy} onClick={clearRuns} style={controls.baseButton}>
          clear history
        </button>
      </div>

      <div style={panel}>
        <div style={{ ...mono, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600 }}>
            pipeline (scan+parse+transform): {fmt(onPipelineMs)} ms vs {fmt(offPipelineMs)} ms
            {offPipelineMs > 0 && (
              <span style={{ color: pipelineSaving > 0 ? theme.good : theme.bad }}>
                {' '}
                → {(pipelineSaving * 100).toFixed(0)}% {pipelineSaving >= 0 ? 'saved' : 'REGRESSION'}
              </span>
            )}
          </span>
          <span style={{ color: theme.textMuted }}>
            commit Δ {fmt(commitDelta)} ms (noisy — the stage numbers are the attribution-clean signal)
          </span>
        </div>
        {stageRow('incremental ON', onStages)}
        {stageRow('incremental OFF', offStages)}
        <div
          data-testid="xckc-summary"
          data-running={running ? 'true' : 'false'}
          data-frames={equality.frames}
          data-mismatches={equality.mismatches}
          data-scan-count={scanCount}
          style={{ ...mono, color: equalityDone ? equalityColor : theme.textMuted }}
        >
          DOM equality: {equality.frames} frames, {equality.mismatches} mismatches
          {equalityDone &&
            (equality.mismatches === 0
              ? ' — byte-identical every frame ✓'
              : ` — FIRST DIVERGENCE at content length ${equality.firstMismatchLength} ✗ (this is a bug; file it)`)}
          {running && ' (comparing…)'}
        </div>
        {sameConfigRuns.length > 0 && (
          <div style={{ ...mono, color: theme.textMuted }}>
            runs (Δ commit ms, +ve = incremental faster):{' '}
            {sameConfigRuns.map((r) => (r.deltaTotal >= 0 ? '+' : '') + r.deltaTotal.toFixed(1)).join(' · ')}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={column}>
          <div style={{ ...mono, color: theme.textMuted }}>
            <span style={{ color: theme.good }}>● </span>
            coordinated · incrementalParse: true
          </div>
          <ProfilerPanel snapshot={onProfiler.snapshot} colorScheme={colorScheme} compact />
          <Profiler id="xckc-on" onRender={onProfiler.onRender}>
            <div ref={onProfiler.targetRef}>
              <CoordinatedSide
                docId={ON_DOC_ID}
                config={ON_CONFIG}
                chunkContents={chunkContents}
                running={running}
                colorScheme={colorScheme}
                domRef={onDomRef}
              />
            </div>
          </Profiler>
        </div>
        <div style={column}>
          <div style={{ ...mono, color: theme.textMuted }}>
            <span style={{ color: theme.warn }}>● </span>
            coordinated · incrementalParse: false
          </div>
          <ProfilerPanel snapshot={offProfiler.snapshot} colorScheme={colorScheme} compact />
          <Profiler id="xckc-off" onRender={offProfiler.onRender}>
            <div ref={offProfiler.targetRef}>
              <CoordinatedSide
                docId={OFF_DOC_ID}
                config={OFF_CONFIG}
                chunkContents={chunkContents}
                running={running}
                colorScheme={colorScheme}
                domRef={offDomRef}
              />
            </div>
          </Profiler>
        </div>
      </div>
    </div>
  );
};
