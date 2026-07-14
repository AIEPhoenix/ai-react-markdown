'use client';

import { Profiler, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import AIMarkdown from '../../src/index';
import { DEFAULT_PAYLOAD, type ScenarioKey } from './scenarios';
import { useRenderProfiler } from './useRenderProfiler';
import { ProfilerPanel } from './ProfilerPanel';
import { controlStyles, getStreamingTheme, thinScrollbar, type ColorScheme } from './theme';
import { PAYLOAD_SCALES, useComparisonRuns } from './useComparisonRuns';
import { shortenDocumentId } from '../../src/components/shortenDocumentId';

/**
 * Side-by-side A/B for `incrementalParseEnabled` — BOTH columns run the
 * block-memo renderer (default config); the only difference is the flag.
 *
 * How this differs from `BlockMemoComparison` and why it is a separate
 * component rather than a third toggle there:
 *
 * - **The attribution-clean signal is the per-side STAGE table**, not React
 *   commit deltas. Incremental parsing changes exactly the scan/parse/
 *   transform stages; both sides emit stage timings (both are block-memo),
 *   so each profiler scopes its subscription with `stageInstanceId` — the
 *   page-wide channel now carries the emitting instance's documentId.
 *   Commit totals are shown too, but for realistic payloads they are
 *   noise-dominated: parse is milliseconds per frame while commit includes
 *   everything else.
 * - **Verification is built in**: every streamed frame deep-compares the
 *   two columns' live `innerHTML`. The mismatch counter must stay 0 — the
 *   flag is contractually invisible in output (splice equivalence). A
 *   non-zero count is a shipping bug, not a tuning concern.
 * - The `defs` toggle appends a footnote/link-definition tail; footnotes
 *   force the incremental side into its `[^` full-parse fallback — flip it
 *   ON to see the honest "feature disengages" behavior (stage numbers
 *   converge, equality still holds).
 */

export type ComparisonVariant = 'incremental' | 'boost';

// Standalone mode (no <AIMarkdownDocuments>): explicit documentIds scope the
// stage channel and keep both sides' clobber prefixes deterministic — the
// equality check normalizes the (intentionally different) prefixes away.
const VARIANTS = {
  /** incremental on vs off — BOTH sides block-memo; the stage table is the
   *  attribution-clean signal, commit deltas are noise-dominated. */
  incremental: {
    onDocId: 'ipc-on',
    offDocId: 'ipc-off',
    onConfig: { blockMemoEnabled: true, incrementalParseEnabled: true } as const,
    offConfig: { blockMemoEnabled: true, incrementalParseEnabled: false } as const,
    onLabel: 'incrementalParseEnabled: true',
    offLabel: 'incrementalParseEnabled: false',
    /** Legacy never calls measureStage; both sides here are block-memo. */
    offEmitsStages: true,
  },
  /** boost: EVERYTHING on vs EVERYTHING off — (block-memo + incremental)
   *  vs the legacy full pipeline. The commit delta IS the headline here
   *  (it is the end-to-end optimization), and the off side emits no stage
   *  timings at all (legacy path has no instrumentation). */
  boost: {
    onDocId: 'boost-on',
    offDocId: 'boost-off',
    onConfig: { blockMemoEnabled: true, incrementalParseEnabled: true } as const,
    offConfig: { blockMemoEnabled: false } as const,
    onLabel: 'boost: block-memo + incremental (all on)',
    offLabel: 'legacy: full pipeline every frame (all off)',
    offEmitsStages: false,
  },
} satisfies Record<ComparisonVariant, unknown>;

const PIPELINE_STAGES_SHOWN = ['scan', 'parse', 'transform'] as const;

/**
 * The two sides intentionally use DIFFERENT documentIds (that is what scopes
 * the stage channel per side) — and documentId feeds the clobber prefix that
 * rehype-sanitize/rehypeRebaseHashLinks stamp onto footnote ids and hash
 * hrefs. The moment a footnote reference renders, the raw innerHTML of the
 * two sides differs BY CONFIGURATION (`ipc-on-user-content-fn-1` vs
 * `ipc-off-user-content-fn-1`), not by any splice defect. Normalize both
 * prefixes to a shared token before comparing. Found in the field: a
 * footnote-bearing payload lit the mismatch counter at the exact offset the
 * first `[^` reference rendered, while the node-level arbiter proved the
 * engine byte-clean on the same payload.
 *
 * Built with the SAME derivation as src/context.tsx (shortenDocumentId +
 * encodeURIComponent), so renaming the docIds — even past the 16-char
 * hashing threshold — can never silently desynchronize the replace.
 */
const normalizeClobberPrefix = (html: string, docId: string): string =>
  html.replaceAll(`${encodeURIComponent(shortenDocumentId(docId))}-user-content-`, '§doc§-user-content-');

interface IncrementalParseComparisonProps {
  colorScheme: ColorScheme;
  initialScenario?: ScenarioKey;
  /** Run the initial scenario automatically on mount. Default true. */
  autoStart?: boolean;
  /** Base markdown payload (multiplied by the payload scale). */
  payload?: string;
  /** Which A/B to run — see VARIANTS. Default 'incremental'. */
  variant?: ComparisonVariant;
}

const fmt = (n: number, digits = 1) => (Number.isFinite(n) && !Number.isNaN(n) ? n.toFixed(digits) : '—');

function pipelineTotal(stages: Record<string, { total: number }>): number {
  return PIPELINE_STAGES_SHOWN.reduce((sum, key) => sum + (stages[key]?.total ?? 0), 0);
}

export const IncrementalParseComparison = ({
  colorScheme,
  initialScenario = 'randomTokens',
  autoStart = true,
  payload = DEFAULT_PAYLOAD,
  variant = 'incremental',
}: IncrementalParseComparisonProps) => {
  const V = VARIANTS[variant];
  const [content, setContent] = useState('');
  const [running, setRunning] = useState(false);
  const theme = getStreamingTheme(colorScheme);
  const controls = controlStyles(theme);

  // Both sides emit stage timings — scope each subscription to its own
  // instance, otherwise the two panels would show the same union.
  const onProfiler = useRenderProfiler<HTMLDivElement>({ running, observeStages: true, stageInstanceId: V.onDocId });
  const offProfiler = useRenderProfiler<HTMLDivElement>({ running, observeStages: true, stageInstanceId: V.offDocId });

  // Per-frame DOM equality (the verification half of this story).
  const onDomRef = useRef<HTMLDivElement>(null);
  const offDomRef = useRef<HTMLDivElement>(null);
  const equalityRef = useRef({ frames: 0, mismatches: 0, firstMismatchLength: -1 });
  const [equality, setEquality] = useState(equalityRef.current);

  const begin = useCallback(() => {
    setContent('');
    equalityRef.current = { frames: 0, mismatches: 0, firstMismatchLength: -1 };
    setEquality(equalityRef.current);
    onProfiler.reset();
    offProfiler.reset();
  }, [onProfiler, offProfiler]);
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
    payloadScale,
    setPayloadScale,
    defsEnabled,
    setDefsEnabled,
    setSpyEnabled,
    setIncrementalEnabled,
    sameConfigRuns,
    clearRuns,
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
    enabledSnapshot: onProfiler.snapshot,
    disabledSnapshot: offProfiler.snapshot,
    begin,
    push,
  });

  // Keep RunRecord fields truthful: the on-side always runs incremental in
  // both variants, and this comparison installs NO spy components (the hook
  // defaults would otherwise record spy:true + deltaElem:0, corrupting
  // cross-run comparisons against records where those fields are real).
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

  // Post-commit: both columns have rendered THIS content — compare live DOM.
  useEffect(() => {
    if (!content || !onDomRef.current || !offDomRef.current) return;
    const eq = equalityRef.current;
    eq.frames += 1;
    const onHtml = normalizeClobberPrefix(onDomRef.current.innerHTML, V.onDocId);
    const offHtml = normalizeClobberPrefix(offDomRef.current.innerHTML, V.offDocId);
    if (onHtml !== offHtml) {
      eq.mismatches += 1;
      if (eq.firstMismatchLength === -1) eq.firstMismatchLength = content.length;
    }
    if (!running) setEquality({ ...eq });
  }, [content, running, V.onDocId, V.offDocId]);

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
  const markdownBox: CSSProperties = {
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 8,
    padding: 12,
    maxHeight: 380,
    overflow: 'auto',
    ...thinScrollbar,
  };

  const equalityDone = !running && equality.frames > 0;
  const equalityColor = equality.mismatches === 0 ? theme.good : theme.bad;

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
        <span style={{ ...controls.caption, marginLeft: 8 }}>payload</span>
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
        <button
          disabled={busy}
          onClick={() => setDefsEnabled(!defsEnabled)}
          style={controls.baseButton}
          title="Appends a footnote/link-definition tail. Footnotes ([^…]) force the incremental side into its full-parse fallback — flip ON to watch the feature disengage honestly: stage numbers converge while DOM equality still holds."
        >
          defs: {defsEnabled ? 'ON (incremental will fall back)' : 'OFF'}
        </button>
        <span style={controls.caption}>
          {payloadChars.toLocaleString()} chars / {payloadBlocks} blocks
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
          {V.offEmitsStages ? (
            <span style={{ fontWeight: 600 }}>
              pipeline (scan+parse+transform): {fmt(onPipelineMs)} ms vs {fmt(offPipelineMs)} ms
              {offPipelineMs > 0 && (
                <span style={{ color: pipelineSaving > 0 ? theme.good : theme.bad }}>
                  {' '}
                  → {(pipelineSaving * 100).toFixed(0)}% {pipelineSaving >= 0 ? 'saved' : 'REGRESSION'}
                </span>
              )}
            </span>
          ) : (
            <span style={{ fontWeight: 600 }}>
              commit total: {fmt(onProfiler.snapshot.actual.total)} ms vs {fmt(offProfiler.snapshot.actual.total)} ms
              {offProfiler.snapshot.actual.total > 0 && (
                <span style={{ color: commitDelta > 0 ? theme.good : theme.bad }}>
                  {' '}
                  → Δ {fmt(commitDelta)} ms {commitDelta >= 0 ? 'saved' : 'REGRESSION'}
                </span>
              )}
            </span>
          )}
          <span style={{ color: theme.textMuted }}>
            {V.offEmitsStages
              ? `commit Δ ${fmt(commitDelta)} ms (noisy — the stage numbers are the attribution-clean signal)`
              : `boost = the end-to-end saving; dev-build ms run large, only the relative gap matters`}
          </span>
        </div>
        {stageRow(V.offEmitsStages ? 'incremental ON' : 'boost ON', onStages)}
        {V.offEmitsStages ? (
          stageRow('incremental OFF', offStages)
        ) : (
          <div style={{ ...mono, color: theme.textMuted }}>
            legacy side — no stage timings (the legacy path is uninstrumented); compare commit totals above
          </div>
        )}
        <div style={{ ...mono, color: equalityDone ? equalityColor : theme.textMuted }}>
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
            {V.onLabel}
          </div>
          <ProfilerPanel snapshot={onProfiler.snapshot} colorScheme={colorScheme} compact />
          <Profiler id="ipc-on" onRender={onProfiler.onRender}>
            <div ref={onProfiler.targetRef}>
              <div ref={onDomRef} style={markdownBox}>
                <AIMarkdown
                  content={content}
                  streaming={running}
                  documentId={V.onDocId}
                  config={V.onConfig}
                  colorScheme={colorScheme}
                />
              </div>
            </div>
          </Profiler>
        </div>
        <div style={column}>
          <div style={{ ...mono, color: theme.textMuted }}>
            <span style={{ color: theme.warn }}>● </span>
            {V.offLabel}
          </div>
          <ProfilerPanel snapshot={offProfiler.snapshot} colorScheme={colorScheme} compact />
          <Profiler id="ipc-off" onRender={offProfiler.onRender}>
            <div ref={offProfiler.targetRef}>
              <div ref={offDomRef} style={markdownBox}>
                <AIMarkdown
                  content={content}
                  streaming={running}
                  documentId={V.offDocId}
                  config={V.offConfig}
                  colorScheme={colorScheme}
                />
              </div>
            </div>
          </Profiler>
        </div>
      </div>
    </div>
  );
};
