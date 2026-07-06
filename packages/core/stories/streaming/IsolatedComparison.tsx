'use client';

/**
 * Process-ISOLATED variant of the block-memo comparison.
 *
 * Same controls, verdict, summary and history as `BlockMemoComparison`, but
 * each side renders inside its own CROSS-SITE iframe (`localhost` vs
 * `127.0.0.1` against the same dev server), which Chrome's Site Isolation
 * places in separate renderer processes. That removes every coupling the
 * same-page variant has to mitigate:
 *   - no shared main thread → no ordering effect inside a shared commit
 *   - separate V8 heaps → no GC misattribution across sides
 *   - separate event loops → no pacing coupling
 *   - fps / slow frames / long tasks become genuinely PER-SIDE
 *
 * What it still shares: the machine (CPU cores, memory bandwidth, GPU,
 * thermals). And what it trades away: chunks now arrive via postMessage to
 * two processes, so sub-millisecond delivery skew between sides replaces
 * the same-page guarantee of "both sides in the same setState".
 *
 * Keep BOTH stories: the same-page variant is the fairest JS-layer A/B
 * (identical environment and stream); this one is the only shape that can
 * answer per-side browser-level questions. Disagreement between the two is
 * itself signal.
 *
 * Verify isolation empirically via Chrome's Task Manager (⇧Esc): the two
 * iframe URLs must appear as separate renderer processes. From JS there is
 * no reliable OOPIF probe.
 *
 * @module stories/streaming/IsolatedComparison
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { buildScenarios, countBlocks, DEFAULT_PAYLOAD, SCENARIO_KEYS, type ScenarioKey } from './scenarios';
import { emptySnapshot, type RenderProfilerSnapshot } from './useRenderProfiler';
import { getStreamingTheme, type ColorScheme } from './theme';
import {
  computeSummary,
  PAYLOAD_SCALES,
  RunHistory,
  SummaryBanner,
  VerdictBanner,
  type PayloadScale,
  type RunRecord,
} from './BlockMemoComparison';
import { isProtocolMessage, SIDE_STORY_ID, type HostToSideMessage, type SideMode } from './isolatedProtocol';

interface IsolatedComparisonProps {
  colorScheme: ColorScheme;
  initialScenario?: ScenarioKey;
  /** Base markdown payload (multiplied by the payload scale). */
  payload?: string;
}

interface SideState {
  ready: boolean;
  snapshot: RenderProfilerSnapshot;
}

const initialSideState = (): SideState => ({ ready: false, snapshot: emptySnapshot() });

/** Resolved isolation topology: which loopback host serves each side. */
interface SideHosts {
  memo: string;
  legacy: string;
  /** True when BOTH sides are cross-site to the parent as well as to each
   *  other (three-way isolation). False on the degraded fallback where one
   *  side shares the parent's site — and therefore its process. */
  symmetric: boolean;
}

/**
 * Pick side hosts so that memo, legacy AND the parent are pairwise
 * cross-site — three renderer processes total.
 *
 * Why three-way matters (measured, not theoretical): with the naive
 * two-way split (parent+memo same-site, legacy cross-site), the side that
 * shares the parent's process also shares its main thread, and pays for
 * the host page's own work — snapshot handling and summary re-renders
 * during a run. On this page that showed up as a stable ~330 ms penalty
 * (~60% of a small-payload run!) charged to whichever side sat with the
 * parent; swapping the hosts flipped the sign exactly. Loopback offers
 * three distinct sites for free: `localhost`, `127.0.0.1`, and `[::1]` —
 * the site key is the HOSTNAME (ports are ignored, so two ports on one
 * hostname would NOT separate processes).
 *
 * `[::1]` requires the dev server to listen on IPv6; the caller probes for
 * that and falls back to the asymmetric two-way split (flagged so the UI
 * can warn) when unavailable.
 */
function pickSideHosts(ipv6Available: boolean): SideHosts {
  const { hostname } = window.location;
  const pool = ['127.0.0.1', '[::1]', 'localhost'].filter((h) => h !== hostname);
  const usable = ipv6Available ? pool : pool.filter((h) => h !== '[::1]');
  if (usable.length >= 2) {
    return { memo: usable[0], legacy: usable[1], symmetric: true };
  }
  // Degraded: only one loopback alias differs from the parent (e.g. IPv6
  // unavailable and the parent already occupies one of the IPv4 names).
  return { memo: hostname, legacy: usable[0] ?? '127.0.0.1', symmetric: false };
}

/** Build one side's iframe URL. `globals=theme:` keeps the side story's
 *  withThemedBackground decorator in sync with the host's theme; the bmc*
 *  params configure the side itself. */
function buildSideUrl(host: string, mode: SideMode, spy: boolean, scheme: ColorScheme): string {
  const { protocol, port } = window.location;
  return (
    `${protocol}//${host}${port ? `:${port}` : ''}/iframe.html?id=${SIDE_STORY_ID}&viewMode=story` +
    `&globals=theme:${scheme}&bmcMode=${mode}&bmcSpy=${spy ? 'on' : 'off'}&bmcScheme=${scheme}`
  );
}

export const IsolatedComparison = ({
  colorScheme,
  initialScenario = 'randomTokens',
  payload = DEFAULT_PAYLOAD,
}: IsolatedComparisonProps) => {
  const [scenario, setScenario] = useState<ScenarioKey>(initialScenario);
  const [payloadScale, setPayloadScale] = useState<PayloadScale>(1);
  const [spyEnabled, setSpyEnabled] = useState(true);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [memoSide, setMemoSide] = useState<SideState>(initialSideState);
  const [legacySide, setLegacySide] = useState<SideState>(initialSideState);

  const cancelRef = useRef<(() => void) | null>(null);
  const memoFrameRef = useRef<HTMLIFrameElement | null>(null);
  const legacyFrameRef = useRef<HTMLIFrameElement | null>(null);
  const pendingRunRef = useRef<{
    scenario: ScenarioKey;
    scale: PayloadScale;
    chars: number;
    blocks: number;
    spy: boolean;
  } | null>(null);
  const multiRemainingRef = useRef(0);

  const basePayload = payload || DEFAULT_PAYLOAD;
  const effectivePayload = useMemo(() => basePayload.repeat(payloadScale), [basePayload, payloadScale]);
  const payloadChars = effectivePayload.length;
  const payloadBlocks = useMemo(() => countBlocks(effectivePayload), [effectivePayload]);
  const scenarios = useMemo(() => buildScenarios(effectivePayload), [effectivePayload]);
  const theme = getStreamingTheme(colorScheme);

  // Isolation topology, resolved once: probe whether the dev server also
  // listens on IPv6 loopback (`[::1]`), which unlocks the three-way
  // cross-site split (see pickSideHosts). Falls back — flagged — otherwise.
  const [sideHosts, setSideHosts] = useState<SideHosts | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { protocol, port } = window.location;
      let ipv6: boolean;
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 1500);
        await fetch(`${protocol}//[::1]${port ? `:${port}` : ''}/iframe.html`, {
          mode: 'no-cors',
          signal: controller.signal,
        });
        window.clearTimeout(timer);
        ipv6 = true;
      } catch {
        ipv6 = false;
      }
      if (alive) setSideHosts(pickSideHosts(ipv6));
    })();
    return () => {
      alive = false;
    };
  }, []);

  // URLs depend on topology + spy/scheme; changing any remounts both
  // iframes (React key) and re-runs the ready handshake.
  const urls = useMemo(
    () =>
      sideHosts
        ? {
            memo: buildSideUrl(sideHosts.memo, 'memo', spyEnabled, colorScheme),
            legacy: buildSideUrl(sideHosts.legacy, 'legacy', spyEnabled, colorScheme),
          }
        : null,
    [sideHosts, spyEnabled, colorScheme]
  );
  const framesKey = `${sideHosts?.memo}-${sideHosts?.legacy}-${spyEnabled}-${colorScheme}`;

  const broadcast = useCallback((msg: HostToSideMessage) => {
    memoFrameRef.current?.contentWindow?.postMessage(msg, '*');
    legacyFrameRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  // Host quiescence: while a run is live, snapshot messages land in refs
  // and are flushed to state at a coarse cadence instead of per-message.
  // Two snapshot streams at 10 Hz each would otherwise re-render the whole
  // host page ~20×/s during the measurement window — work that, on the
  // degraded (non-symmetric) topology, executes on the same main thread as
  // one of the measured sides. Once `running` is false, messages flush
  // synchronously again so the final snapshots land immediately.
  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  const pendingSnapsRef = useRef<{ memo?: RenderProfilerSnapshot; legacy?: RenderProfilerSnapshot }>({});
  const flushPendingSnaps = useCallback(() => {
    const pending = pendingSnapsRef.current;
    pendingSnapsRef.current = {};
    if (pending.memo) {
      const snap = pending.memo;
      setMemoSide((prev) => ({ ...prev, snapshot: snap }));
    }
    if (pending.legacy) {
      const snap = pending.legacy;
      setLegacySide((prev) => ({ ...prev, snapshot: snap }));
    }
  }, []);
  useEffect(() => {
    if (!running) {
      flushPendingSnaps();
      return;
    }
    const id = window.setInterval(flushPendingSnaps, 500);
    return () => window.clearInterval(id);
  }, [running, flushPendingSnaps]);

  // Inbound: ready handshakes and snapshot ticks. Source is verified
  // against our two owned iframes — the claimed `mode` field is only
  // trusted after that check.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isProtocolMessage(data)) return;
      const fromMemo = event.source === memoFrameRef.current?.contentWindow;
      const fromLegacy = event.source === legacyFrameRef.current?.contentWindow;
      if (!fromMemo && !fromLegacy) return;
      if (data.type === 'bmc:ready') {
        const setSide = fromMemo ? setMemoSide : setLegacySide;
        setSide(() => ({ ...initialSideState(), ready: true }));
      } else if (data.type === 'bmc:snapshot') {
        if (runningRef.current) {
          pendingSnapsRef.current[fromMemo ? 'memo' : 'legacy'] = data.snapshot;
        } else {
          const setSide = fromMemo ? setMemoSide : setLegacySide;
          setSide((prev) => ({ ...prev, snapshot: data.snapshot }));
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const bothReady = memoSide.ready && legacySide.ready;

  const stop = useCallback(() => {
    multiRemainingRef.current = 0;
    cancelRef.current?.();
    cancelRef.current = null;
    broadcast({ type: 'bmc:stop' });
    setRunning(false);
  }, [broadcast]);

  const start = useCallback(() => {
    if (!bothReady) return;
    cancelRef.current?.();
    pendingRunRef.current = {
      scenario,
      scale: payloadScale,
      chars: payloadChars,
      blocks: payloadBlocks,
      spy: spyEnabled,
    };
    broadcast({ type: 'bmc:start' });
    setRunning(true);
    const push = (chunk: string) => broadcast({ type: 'bmc:chunk', text: chunk });
    const done = () => {
      broadcast({ type: 'bmc:stop' });
      setRunning(false);
    };
    cancelRef.current = scenarios[scenario].run(push, done);
  }, [bothReady, scenario, scenarios, payloadScale, payloadChars, payloadBlocks, spyEnabled, broadcast]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });

  const startMulti = useCallback(() => {
    multiRemainingRef.current = 2; // this run + 2 repeats = 3 total
    start();
  }, [start]);

  // Latest side snapshots behind refs for the deferred history record.
  // Mirrored in an effect (not during render) to satisfy react-hooks/refs;
  // the deferred reader below fires ≥400 ms later, long after these commit.
  const memoSnapRef = useRef(memoSide.snapshot);
  const legacySnapRef = useRef(legacySide.snapshot);
  useEffect(() => {
    memoSnapRef.current = memoSide.snapshot;
    legacySnapRef.current = legacySide.snapshot;
  }, [memoSide.snapshot, legacySide.snapshot]);

  // Record a finished run — same deferred pattern as the same-page variant,
  // with a longer settle delay: each side's FINAL snapshot crosses a
  // process boundary before it reaches us.
  useEffect(() => {
    if (running) return;
    const pending = pendingRunRef.current;
    if (!pending) return;
    if (memoSide.snapshot.actual.count === 0 || legacySide.snapshot.actual.count === 0) return;
    pendingRunRef.current = null;
    window.setTimeout(() => {
      const e = memoSnapRef.current;
      const d = legacySnapRef.current;
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
    }, 400);
  }, [running, memoSide.snapshot, legacySide.snapshot]);

  useEffect(() => () => cancelRef.current?.(), []);

  const sameConfigRuns = useMemo(
    () => runs.filter((r) => r.scenario === scenario && r.scale === payloadScale && r.spy === spyEnabled),
    [runs, scenario, payloadScale, spyEnabled]
  );
  const summary = computeSummary(memoSide.snapshot, legacySide.snapshot, spyEnabled, sameConfigRuns, true);
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
  const frameStyle: CSSProperties = {
    background: 'transparent',
    border: `1px solid ${theme.surfaceBorder}`,
    borderRadius: 8,
    height: 760,
    width: '100%',
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
          title="Spies count component invocations but add overhead that scales with render count. Toggling remounts both frames."
        >
          spy: {spyEnabled ? 'ON (component counts)' : 'OFF (clean timing)'}
        </button>
      </div>

      <div style={buttonRowStyle}>
        <button onClick={running ? stop : start} disabled={!running && !bothReady} style={primaryButton}>
          {running ? 'Stop' : bothReady ? 'Run scenario' : 'Waiting for frames…'}
        </button>
        <button
          disabled={running || !bothReady}
          onClick={startMulti}
          style={baseButton}
          title="Run the same config 3 times back-to-back to expose run-to-run variance."
        >
          Run ×3
        </button>
        <button
          onClick={() => {
            stop();
            broadcast({ type: 'bmc:reset' });
            setMemoSide((prev) => ({ ...prev, snapshot: emptySnapshot() }));
            setLegacySide((prev) => ({ ...prev, snapshot: emptySnapshot() }));
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
        <div style={{ marginTop: 2 }}>
          {sideHosts
            ? sideHosts.symmetric
              ? `process isolation: three-way cross-site · host ${window.location.hostname} / memo ${sideHosts.memo} / legacy ${sideHosts.legacy} — verify via Chrome Task Manager (⇧Esc): each frame URL owns its own renderer process.`
              : `⚠ degraded isolation: ${sideHosts.memo === window.location.hostname ? 'memo' : 'legacy'} side shares the host page's process (dev server has no [::1] listener) — that side absorbs the host UI's work and reads SLOWER than it is. Trust the other metrics loosely.`
            : 'probing isolation topology…'}
        </div>
      </div>

      <VerdictBanner
        summary={summary}
        sameConfigRuns={sameConfigRuns}
        payloadScale={payloadScale}
        payloadChars={payloadChars}
        payloadBlocks={payloadBlocks}
        spyEnabled={spyEnabled}
        colorScheme={colorScheme}
        isolated
      />

      <SummaryBanner summary={summary} colorScheme={colorScheme} />

      {urls ? (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <iframe
            key={`memo-${framesKey}`}
            ref={memoFrameRef}
            src={urls.memo}
            style={frameStyle}
            title="blockMemo enabled (isolated)"
          />
          <iframe
            key={`legacy-${framesKey}`}
            ref={legacyFrameRef}
            src={urls.legacy}
            style={frameStyle}
            title="blockMemo disabled (isolated)"
          />
        </div>
      ) : null}

      <RunHistory runs={runs} onClear={() => setRuns([])} colorScheme={colorScheme} />
    </div>
  );
};
