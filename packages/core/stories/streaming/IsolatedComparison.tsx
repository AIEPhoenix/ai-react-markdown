'use client';

/**
 * Process-ISOLATED variant of the block-memo comparison.
 *
 * Same controls, verdict, summary and history as `BlockMemoComparison`
 * (shared via useComparisonRuns + the exported display components), but
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
 * REQUIRES viewing from the dev-server machine via a loopback hostname:
 * the side URLs point at the VIEWER's own loopback aliases, so a LAN /
 * tunnel / remote-dev viewer would load nothing. The story detects that
 * and says so instead of waiting forever.
 *
 * @module stories/streaming/IsolatedComparison
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_PAYLOAD, SCENARIO_KEYS, type ScenarioKey } from './scenarios';
import { emptySnapshot, type RenderProfilerSnapshot } from './useRenderProfiler';
import { controlStyles, getStreamingTheme, type ColorScheme } from './theme';
import { computeSummary, RunHistory, SummaryBanner, VerdictBanner } from './BlockMemoComparison';
import { PAYLOAD_SCALES, useComparisonRuns } from './useComparisonRuns';
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

const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

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
  const pool = LOOPBACK_HOSTNAMES.filter((h) => h !== hostname);
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
function buildSideUrl(host: string, mode: SideMode, spy: boolean, registry: boolean, scheme: ColorScheme): string {
  const { protocol, port } = window.location;
  return (
    `${protocol}//${host}${port ? `:${port}` : ''}/iframe.html?id=${SIDE_STORY_ID}&viewMode=story` +
    `&globals=theme:${scheme}&bmcMode=${mode}&bmcSpy=${spy ? 'on' : 'off'}` +
    `&bmcRegistry=${registry ? 'on' : 'off'}&bmcScheme=${scheme}`
  );
}

/** sessionStorage, tolerating disabled/blocked storage. */
const readSession = (key: string): string | null => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeSession = (key: string, value: string): void => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked — probe again next visit */
  }
};

/** IPv6 probe verdicts expire after this long — long enough to amortize
 *  the 1.5 s worst-case probe across story visits, short enough that a
 *  mid-session dev-server change (listener gained OR lost) self-heals. */
const PROBE_TTL_MS = 60_000;
const readProbeCache = (key: string): boolean | null => {
  const raw = readSession(key);
  if (!raw) return null;
  const [verdict, expiresAt] = raw.split(':');
  // Old-format entries (no expiry) parse as NaN and re-probe — harmless.
  return Number(expiresAt) > Date.now() ? verdict === '1' : null;
};
const writeProbeCache = (key: string, ipv6: boolean): void => {
  writeSession(key, `${ipv6 ? '1' : '0'}:${Date.now() + PROBE_TTL_MS}`);
};

export const IsolatedComparison = ({
  colorScheme,
  initialScenario = 'randomTokens',
  payload = DEFAULT_PAYLOAD,
}: IsolatedComparisonProps) => {
  const [running, setRunning] = useState(false);
  const [memoSide, setMemoSide] = useState<SideState>(initialSideState);
  const [legacySide, setLegacySide] = useState<SideState>(initialSideState);

  const memoFrameRef = useRef<HTMLIFrameElement | null>(null);
  const legacyFrameRef = useRef<HTMLIFrameElement | null>(null);

  const theme = getStreamingTheme(colorScheme);

  // The side URLs point at the VIEWER's loopback aliases, so the whole
  // story only works when the page itself is opened from the dev-server
  // machine via a loopback hostname. Detect the LAN/tunnel/remote case up
  // front and explain, instead of pointing two iframes at hosts that serve
  // nothing and waiting on a handshake that can never arrive.
  const loopbackHost = LOOPBACK_HOSTNAMES.includes(window.location.hostname);

  // Isolation topology: probe whether the dev server also listens on IPv6
  // loopback (`[::1]`), which unlocks the three-way cross-site split (see
  // pickSideHosts). The verdict — EITHER way — is cached with a short TTL:
  // stale-success can't wedge the story after a mid-session server restart
  // that dropped [::1] (it re-validates within a minute), stale-failure
  // can't lock the tab into degraded topology after the listener comes up,
  // and an IPv4-only host pays the 1.5 s worst-case probe at most once per
  // TTL instead of on every visit. One symmetric mechanism, no staleness
  // direction favored.
  const [sideHosts, setSideHosts] = useState<SideHosts | null>(null);
  useEffect(() => {
    if (!loopbackHost) return;
    let alive = true;
    (async () => {
      const { protocol, port, host } = window.location;
      const cacheKey = `bmc:ipv6-probe:${protocol}//${host}`;
      let ipv6 = readProbeCache(cacheKey);
      if (ipv6 === null) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 1500);
        try {
          await fetch(`${protocol}//[::1]${port ? `:${port}` : ''}/iframe.html`, {
            mode: 'no-cors',
            signal: controller.signal,
          });
          ipv6 = true;
        } catch {
          ipv6 = false;
        } finally {
          window.clearTimeout(timer);
        }
        writeProbeCache(cacheKey, ipv6);
      }
      if (alive) setSideHosts(pickSideHosts(ipv6));
    })();
    return () => {
      alive = false;
    };
  }, [loopbackHost]);

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

  // Inbound: ready handshakes and snapshot ticks. Side identity comes
  // SOLELY from `event.source` against our two owned iframes — the
  // protocol deliberately carries no self-identification to route by.
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

  // postMessage transport; run bookkeeping (history, Run ×3, noise-band
  // inputs) lives in the shared useComparisonRuns hook.
  const canStart = useCallback(() => bothReady, [bothReady]);
  const begin = useCallback(() => {
    // Clear the LOCAL snapshot mirrors before the remote resets kick in —
    // the record handshake keys on `settled`, and a previous run's settled
    // final must never be able to satisfy it while this run's snapshots
    // are still crossing the process boundary (mirrors the same-page
    // variant, whose begin() resets both profilers synchronously).
    setMemoSide((prev) => ({ ...prev, snapshot: emptySnapshot() }));
    setLegacySide((prev) => ({ ...prev, snapshot: emptySnapshot() }));
    broadcast({ type: 'bmc:start' });
  }, [broadcast]);
  const push = useCallback((chunk: string) => broadcast({ type: 'bmc:chunk', text: chunk }), [broadcast]);
  const end = useCallback(() => broadcast({ type: 'bmc:stop' }), [broadcast]);

  const {
    scenario,
    setScenario,
    payloadScale,
    setPayloadScale,
    spyEnabled,
    setSpyEnabled,
    registryEnabled,
    setRegistryEnabled,
    defsEnabled,
    setDefsEnabled,
    runs,
    clearRuns,
    sameConfigRuns,
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
    enabledSnapshot: memoSide.snapshot,
    disabledSnapshot: legacySide.snapshot,
    canStart,
    begin,
    push,
    end,
  });

  // URLs depend on topology + spy/scheme. Each iframe is keyed by its own
  // URL, so any change remounts it — and the effect below drops the stale
  // ready flags so Run re-gates on the NEW frames' handshakes (a remounted
  // frame's listeners aren't attached until its story boots).
  const urls = useMemo(
    () =>
      sideHosts
        ? {
            memo: buildSideUrl(sideHosts.memo, 'memo', spyEnabled, registryEnabled, colorScheme),
            legacy: buildSideUrl(sideHosts.legacy, 'legacy', spyEnabled, registryEnabled, colorScheme),
          }
        : null,
    [sideHosts, spyEnabled, registryEnabled, colorScheme]
  );
  // Drop the stale ready flags the moment the URLs change — the remounted
  // frames' handshakes haven't happened yet, so Run must re-gate on them.
  // Done during render (the documented adjust-state-on-prop-change pattern)
  // rather than in an effect: no commit exists where the old `ready` still
  // reads true against the new frames.
  //
  // Compared by STRING, matching the iframes' keys exactly: React may
  // legitimately re-run the memo above and hand back a new object with the
  // same URLs (Fast Refresh re-runs memos while keeping state), and an
  // identity comparison would then clear `ready` without remounting any
  // frame — nothing re-sends bmc:ready and Run wedges on 'Waiting for
  // frames…'. Reset must fire iff the frames actually remount.
  const [prevUrls, setPrevUrls] = useState(urls);
  if (urls?.memo !== prevUrls?.memo || urls?.legacy !== prevUrls?.legacy) {
    setPrevUrls(urls);
    setMemoSide(initialSideState());
    setLegacySide(initialSideState());
  }

  // Recompute per snapshot tick, not per host render (see the same memo in
  // BlockMemoComparison).
  const summary = useMemo(
    () => computeSummary(memoSide.snapshot, legacySide.snapshot, spyEnabled, sameConfigRuns, true),
    [memoSide.snapshot, legacySide.snapshot, spyEnabled, sameConfigRuns]
  );
  const scenarioConfig = scenarios[scenario];

  const controls = controlStyles(theme);
  const frameStyle: CSSProperties = {
    background: 'transparent',
    border: `1px solid ${theme.surfaceBorder}`,
    borderRadius: 8,
    height: 760,
    width: '100%',
  };

  return (
    <div style={controls.layout}>
      <div style={controls.buttonRow}>
        {SCENARIO_KEYS.map((key) => (
          <button
            key={key}
            disabled={busy}
            onClick={() => setScenario(key)}
            style={scenario === key ? controls.primaryButton : controls.baseButton}
          >
            {scenarios[key].label}
          </button>
        ))}
      </div>

      <div style={controls.buttonRow}>
        <span style={controls.caption}>payload</span>
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
        <span style={controls.caption}>
          {payloadChars.toLocaleString()} chars / {payloadBlocks} blocks
        </span>
        <span style={{ ...controls.caption, marginLeft: 8 }}>·</span>
        <button
          disabled={busy}
          onClick={() => setSpyEnabled(!spyEnabled)}
          style={controls.baseButton}
          title="Spies count component invocations but add overhead that scales with render count. Toggling remounts both frames."
        >
          spy: {spyEnabled ? 'ON (component counts)' : 'OFF (clean timing)'}
        </button>
        <button
          disabled={busy}
          onClick={() => setRegistryEnabled(!registryEnabled)}
          style={controls.baseButton}
          title="Runs both sides under AIMarkdownDocuments (coordinated mode: per-token PASS 0 def-label scan). Toggling remounts both frames."
        >
          registry: {registryEnabled ? 'ON (coordinated)' : 'OFF (standalone)'}
        </button>
        <button
          disabled={busy}
          onClick={() => setDefsEnabled(!defsEnabled)}
          style={controls.baseButton}
          title="Appends a footnote/link-reference definitions tail (plus in-text references) to the scaled payload — the default payload has zero defs. Note: the cross-chunk phantom path still doesn't run; each side is a single chunk. Content streams FROM the host, so no URL param is needed."
        >
          defs: {defsEnabled ? 'ON (defs tail appended)' : 'OFF'}
        </button>
      </div>

      <div style={controls.buttonRow}>
        <button onClick={running ? stop : start} disabled={!running && !bothReady} style={controls.primaryButton}>
          {running ? 'Stop' : bothReady ? 'Run scenario' : 'Waiting for frames…'}
        </button>
        <button
          disabled={busy || !bothReady}
          onClick={startMulti}
          style={controls.baseButton}
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
          style={controls.baseButton}
        >
          Reset
        </button>
      </div>

      <div style={controls.caption}>
        <div>
          <strong style={{ color: theme.text }}>{scenarioConfig.label}</strong>
        </div>
        <div style={{ marginTop: 2 }}>{scenarioConfig.description}</div>
        <div style={{ marginTop: 2 }}>
          {!loopbackHost
            ? `⚠ unavailable from ${window.location.hostname}: the side iframes point at the VIEWER's loopback (127.0.0.1 / [::1] / localhost), which only serves Storybook on the dev machine itself. Open this story via http://localhost:<port> on the machine running the dev server.`
            : sideHosts
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
            key={urls.memo}
            ref={memoFrameRef}
            src={urls.memo}
            style={frameStyle}
            title="blockMemo enabled (isolated)"
          />
          <iframe
            key={urls.legacy}
            ref={legacyFrameRef}
            src={urls.legacy}
            style={frameStyle}
            title="blockMemo disabled (isolated)"
          />
        </div>
      ) : null}

      <RunHistory runs={runs} onClear={clearRuns} colorScheme={colorScheme} />
    </div>
  );
};
