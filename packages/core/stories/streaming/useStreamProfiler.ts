'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfilerOnRenderCallback } from 'react';

export interface ChunkSample {
  index: number;
  size: number;
  delay: number;
  timestamp: number;
}

export interface ProfilerSnapshot {
  commits: number;
  totalCommitMs: number;
  maxCommitMs: number;
  lastCommitMs: number;
  avgCommitMs: number;

  fps: number;
  minFps: number;
  slowFrameCount: number; // FPS < 30
  rafCount: number;

  chunks: ChunkSample[];
  totalChars: number;

  lastResetAt: number;
  /** True once at least one React.Profiler onRender callback has fired. */
  profilerActive: boolean;
}

const initial = (): ProfilerSnapshot => ({
  commits: 0,
  totalCommitMs: 0,
  maxCommitMs: 0,
  lastCommitMs: 0,
  avgCommitMs: 0,
  fps: 0,
  minFps: Number.POSITIVE_INFINITY,
  slowFrameCount: 0,
  rafCount: 0,
  chunks: [],
  totalChars: 0,
  lastResetAt: performance.now(),
  profilerActive: false,
});

export const useStreamProfiler = (snapshotIntervalMs = 100) => {
  const accumRef = useRef<ProfilerSnapshot>(initial());
  const [snapshot, setSnapshot] = useState<ProfilerSnapshot>(accumRef.current);
  const lastChunkAtRef = useRef<number>(performance.now());

  const onRender = useCallback<ProfilerOnRenderCallback>((_id, _phase, actualDuration) => {
    const acc = accumRef.current;
    acc.commits += 1;
    acc.totalCommitMs += actualDuration;
    acc.lastCommitMs = actualDuration;
    if (actualDuration > acc.maxCommitMs) acc.maxCommitMs = actualDuration;
    acc.avgCommitMs = acc.totalCommitMs / acc.commits;
    acc.profilerActive = true;
  }, []);

  const recordChunk = useCallback((chunk: string) => {
    const now = performance.now();
    const acc = accumRef.current;
    acc.chunks.push({
      index: acc.chunks.length,
      size: chunk.length,
      delay: Math.round(now - lastChunkAtRef.current),
      timestamp: now,
    });
    acc.totalChars += chunk.length;
    lastChunkAtRef.current = now;
    if (acc.chunks.length > 200) acc.chunks = acc.chunks.slice(-200);
  }, []);

  const reset = useCallback(() => {
    const next = initial();
    accumRef.current = next;
    lastChunkAtRef.current = performance.now();
    setSnapshot({ ...next });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSnapshot({ ...accumRef.current, chunks: accumRef.current.chunks.slice() });
    }, snapshotIntervalMs);
    return () => window.clearInterval(id);
  }, [snapshotIntervalMs]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      const fps = delta > 0 ? 1000 / delta : 0;
      const acc = accumRef.current;
      acc.fps = fps;
      acc.rafCount += 1;
      if (fps < acc.minFps) acc.minFps = fps;
      if (fps < 30) acc.slowFrameCount += 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { snapshot, onRender, recordChunk, reset };
};
