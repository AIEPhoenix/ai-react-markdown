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

import React, { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import AIMarkdown from '../../src/index';
import { subscribeStageTimings } from '../../src/components/devStageTimings';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { withThemedBackground } from '../decorators';
import { DEFAULT_PAYLOAD } from './scenarios';

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
  const statsRef = useRef<SmokeStats>({ frames: 0, mismatches: 0, scans: 0, firstMismatchLength: -1 });

  // Count `scan` stage emissions — the incremental engine is the only
  // caller, so scans > 0 proves the flag-on side routed through it.
  useEffect(
    () =>
      subscribeStageTimings((stage) => {
        if (stage === 'scan') statsRef.current.scans += 1;
      }),
    []
  );

  useEffect(() => {
    const codePoints = Array.from(payload);
    let cursor = 0;
    const timer = setInterval(() => {
      cursor += CHUNK_CODE_POINTS;
      if (cursor >= codePoints.length) {
        setContent(payload);
        setDone(true);
        clearInterval(timer);
        return;
      }
      setContent(codePoints.slice(0, cursor).join(''));
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [payload]);

  // Post-commit, both sides have rendered THIS content — compare live DOM.
  useEffect(() => {
    if (!content || !onRef.current || !offRef.current) return;
    const stats = statsRef.current;
    stats.frames += 1;
    if (onRef.current.innerHTML !== offRef.current.innerHTML) {
      stats.mismatches += 1;
      if (stats.firstMismatchLength === -1) stats.firstMismatchLength = content.length;
    }
    if (done) setFinalStats({ ...stats });
  }, [content, done]);

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

export const StreamingSmoke: Story = {
  render: () => <IncrementalParseSmoke payload={DEFAULT_PAYLOAD} />,
  play: async ({ canvasElement }) => {
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
  },
};
