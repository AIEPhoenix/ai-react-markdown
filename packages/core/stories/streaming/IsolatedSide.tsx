'use client';

/**
 * One side of the ISOLATED block-memo comparison. Rendered by the
 * `BlockMemoSide` story inside an iframe owned by `IsolatedComparison`
 * (see isolatedProtocol.ts for the process-isolation rationale).
 *
 * Configuration is read from plain URL query params (NOT storybook args —
 * plain params dodge the args URL-encoding quirks and keep the host's URL
 * builder trivial):
 *   - `bmcMode`:     'memo' | 'legacy' → blockMemoEnabled true/false
 *   - `bmcAxis`:     one of COMPARISON_AXES → which A/B this side belongs
 *                    to (heading copy + on/off attribution); the engine
 *                    wiring itself arrives pre-derived via bmcMode /
 *                    bmcIncremental, which the host reads off AXIS_SIDES
 *   - `bmcIncremental`: 'on' | 'off'   → incrementalParseEnabled
 *   - `bmcSpy`:      'on' | 'off'      → wrap tags in counting spies
 *   - `bmcRegistry`: 'on' | 'off'      → wrap in AIMarkdownDocuments
 *                    (coordinated mode: per-token PASS 0 def-label scan)
 *   - `bmcScheme`:   'light' | 'dark'
 *
 * Everything dynamic arrives via postMessage: the host streams chunks and
 * flips start/stop/reset; this side publishes its profiler snapshot back on
 * every snapshot tick (already 100 ms-throttled by useRenderProfiler).
 *
 * @module stories/streaming/IsolatedSide
 */

import { Profiler, useEffect, useMemo, useState, type CSSProperties } from 'react';
import AIMarkdown from '../../src/index';
import { MaybeCoordinated } from './MaybeCoordinated';
import { useRenderProfiler } from './useRenderProfiler';
import { ProfilerPanel } from './ProfilerPanel';
import { createSpyComponents } from './spyComponents';
import { getStreamingTheme, thinScrollbar, type ColorScheme } from './theme';
import {
  AXIS_HEADINGS,
  AXIS_SIDES,
  isProtocolMessage,
  parseComparisonAxis,
  sideConfig,
  type ComparisonAxis,
  type SideMode,
  type SideToHostMessage,
} from './isolatedProtocol';

function readParams(): {
  mode: SideMode;
  axis: ComparisonAxis;
  incremental: boolean;
  spy: boolean;
  registry: boolean;
  scheme: ColorScheme;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get('bmcMode') === 'legacy' ? 'legacy' : 'memo',
    // Throws on an unrecognized value — a silently-wrong axis would render
    // a plausible-looking side that measures the wrong thing.
    axis: parseComparisonAxis(params.get('bmcAxis')),
    incremental: params.get('bmcIncremental') === 'on',
    spy: params.get('bmcSpy') !== 'off',
    registry: params.get('bmcRegistry') === 'on',
    scheme: params.get('bmcScheme') === 'dark' ? 'dark' : 'light',
  };
}

export const IsolatedSide = () => {
  // Params are fixed for the lifetime of the iframe — the host remounts the
  // iframe (new URL) when mode/spy/scheme change.
  const [{ mode, axis, incremental, spy, registry, scheme }] = useState(readParams);
  const [content, setContent] = useState('');
  const [running, setRunning] = useState(false);
  // Destructured on purpose: react-hooks/refs (v7) treats `handle.x`
  // property chains on a hook result that contains refs as ref accesses
  // during render; plain bindings keep the analyzer satisfied.
  const { snapshot, onRender, targetRef, recordChunk, recordElementRender, reset } = useRenderProfiler<HTMLDivElement>({
    running,
    observeStages: mode === 'memo',
  });
  const theme = getStreamingTheme(scheme);

  // Slim the iframe's own viewport scrollbar too (the side page can be
  // taller than the host's fixed-height iframe). The document root isn't
  // reachable via JSX inline styles, so set the standard properties in an
  // effect; cleanup restores the defaults for story-switch hygiene.
  const { scrollbarWidth, scrollbarColor } = thinScrollbar(theme);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('scrollbar-width', scrollbarWidth);
    root.setProperty('scrollbar-color', scrollbarColor);
    return () => {
      root.removeProperty('scrollbar-width');
      root.removeProperty('scrollbar-color');
    };
  }, [scrollbarWidth, scrollbarColor]);

  // The host derives mode/incremental from AXIS_SIDES when building this
  // page's URL; the mode→flag translation lives in sideConfig, next to that
  // table.
  const config = useMemo(() => sideConfig({ mode, incremental }), [incremental, mode]);
  // Which side of the axis this page is — drives the dot color and heading.
  const isOn = mode === AXIS_SIDES[axis].on.mode && incremental === AXIS_SIDES[axis].on.incremental;
  const spyComponents = useMemo(
    () => (spy ? createSpyComponents(recordElementRender) : undefined),
    [spy, recordElementRender]
  );

  // Command channel from the host. `'*'` target origin: the host is
  // intentionally cross-site (that's the whole point), so we cannot pin a
  // single origin without hardcoding the host/port matrix. Dev-only harness
  // — see isolatedProtocol.ts.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isProtocolMessage(data)) return;
      switch (data.type) {
        case 'bmc:start':
          setContent('');
          reset();
          setRunning(true);
          break;
        case 'bmc:chunk':
          recordChunk(data.text);
          setContent((prev) => prev + data.text);
          break;
        case 'bmc:stop':
          setRunning(false);
          break;
        case 'bmc:reset':
          setRunning(false);
          setContent('');
          reset();
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    const ready: SideToHostMessage = { type: 'bmc:ready' };
    window.parent.postMessage(ready, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [reset, recordChunk]);

  // Publish every snapshot tick to the host. The hook already throttles
  // publishes to 100 ms while running and emits one final snapshot on stop,
  // so this effect's cadence is bounded.
  useEffect(() => {
    const msg: SideToHostMessage = { type: 'bmc:snapshot', snapshot };
    window.parent.postMessage(msg, '*');
  }, [snapshot]);

  const headerStyle: CSSProperties = {
    color: theme.text,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.4,
    margin: 0,
    textTransform: 'uppercase',
  };
  const surfaceStyle: CSSProperties = {
    border: `1px solid ${theme.surfaceBorder}`,
    borderRadius: 8,
    height: 320,
    overflow: 'auto',
    padding: 16,
    ...thinScrollbar(theme),
  };

  // Registry mode (bmcRegistry=on): wrap in AIMarkdownDocuments and pass an
  // explicit documentId — that pair is what opts the chunk into coordinated
  // mode, activating the per-token PASS 0 def-label scan.
  const markdown = (
    <AIMarkdown
      content={content}
      streaming={running}
      colorScheme={scheme}
      config={config}
      customComponents={spyComponents}
      documentId={
        registry ? `bmc-side-${axis === 'incrementalParse' ? (incremental ? 'inc' : 'full') : mode}` : undefined
      }
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      <h4 style={headerStyle}>
        <span style={{ color: isOn ? theme.good : theme.warn }}>● </span>
        {isOn ? AXIS_HEADINGS[axis].on : AXIS_HEADINGS[axis].off}
        <span
          style={{
            color: theme.textMuted,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontWeight: 400,
            marginLeft: 8,
            textTransform: 'none',
          }}
        >
          {window.location.host} · spy {spy ? 'on' : 'off'} · registry {registry ? 'on' : 'off'}
        </span>
      </h4>
      <div style={surfaceStyle} ref={targetRef}>
        <Profiler id={`isolated-${mode}`} onRender={onRender}>
          <MaybeCoordinated enabled={registry}>{markdown}</MaybeCoordinated>
        </Profiler>
      </div>
      <ProfilerPanel snapshot={snapshot} colorScheme={scheme} compact />
    </div>
  );
};
