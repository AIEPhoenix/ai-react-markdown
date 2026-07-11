'use client';

import { Profiler, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import AIMarkdown from '../../src/index';
import { buildScenarios, DEFAULT_PAYLOAD, SCENARIO_KEYS, type ScenarioKey } from './scenarios';
import { useMemo } from 'react';
import { useRenderProfiler } from './useRenderProfiler';
import { ProfilerPanel } from './ProfilerPanel';
import { ChunkPanel } from './ChunkPanel';
import { controlStyles, getStreamingTheme, type ColorScheme } from './theme';

interface PlaygroundProps {
  colorScheme: ColorScheme;
  showProfiler?: boolean;
  initialScenario?: ScenarioKey;
  /** Run the initial scenario automatically on mount. Default true. */
  autoStart?: boolean;
  /** Markdown payload used by every scenario. Falls back to DEFAULT_PAYLOAD. */
  payload?: string;
}

export const StreamingPlayground = ({
  colorScheme,
  showProfiler = true,
  initialScenario = 'randomTokens',
  autoStart = true,
  payload = DEFAULT_PAYLOAD,
}: PlaygroundProps) => {
  const scenarios = useMemo(() => buildScenarios(payload), [payload]);
  const [scenario, setScenario] = useState<ScenarioKey>(initialScenario);
  const [content, setContent] = useState('');
  const [running, setRunning] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const { snapshot, onRender, recordChunk, reset, targetRef } = useRenderProfiler<HTMLDivElement>({ running });
  const theme = getStreamingTheme(colorScheme);

  const stop = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    cancelRef.current?.();
    setContent('');
    reset();
    setRunning(true);

    const push = (chunk: string) => {
      recordChunk(chunk);
      setContent((prev) => prev + chunk);
    };
    const done = () => setRunning(false);

    cancelRef.current = scenarios[scenario].run(push, done);
  }, [scenario, scenarios, recordChunk, reset]);

  useEffect(() => () => cancelRef.current?.(), []);

  useEffect(() => {
    if (!autoStart) return;
    start();
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const config = scenarios[scenario];

  // Shared control styling (theme.ts) — this file used to carry its own
  // near-identical copies, the drift the helper exists to prevent. Only
  // visible delta: the shared buttonRow adds alignItems:'center'.
  const controls = controlStyles(theme);
  const renderSurfaceStyle: CSSProperties = {
    border: `1px solid ${theme.surfaceBorder}`,
    borderRadius: 8,
    minHeight: 200,
    padding: 16,
  };
  const splitStyle: CSSProperties = {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
  };

  const streamingMarkup = (
    <div style={renderSurfaceStyle} ref={targetRef}>
      <Profiler id="streaming-playground" onRender={onRender}>
        <AIMarkdown content={content} streaming={running} colorScheme={colorScheme} />
      </Profiler>
    </div>
  );

  return (
    <div style={controls.layout}>
      <div style={controls.buttonRow}>
        {SCENARIO_KEYS.map((key) => (
          <button
            key={key}
            disabled={running}
            onClick={() => setScenario(key)}
            style={scenario === key ? controls.primaryButton : controls.baseButton}
          >
            {scenarios[key].label}
          </button>
        ))}
      </div>

      <div style={controls.buttonRow}>
        <button onClick={running ? stop : start} style={controls.primaryButton}>
          {running ? 'Stop' : 'Run scenario'}
        </button>
        <button
          onClick={() => {
            stop();
            setContent('');
            reset();
          }}
          style={controls.baseButton}
        >
          Reset
        </button>
      </div>

      <div style={controls.caption}>
        <div>
          <strong style={{ color: theme.text }}>{config.label}</strong>
        </div>
        <div style={{ marginTop: 2 }}>{config.description}</div>
        <div style={{ marginTop: 2, opacity: 0.85 }}>{config.hypothesis}</div>
      </div>

      {showProfiler ? (
        <div style={splitStyle}>
          {streamingMarkup}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ProfilerPanel snapshot={snapshot} colorScheme={colorScheme} />
            <ChunkPanel chunks={snapshot.chunks} colorScheme={colorScheme} />
          </div>
        </div>
      ) : (
        streamingMarkup
      )}
    </div>
  );
};
