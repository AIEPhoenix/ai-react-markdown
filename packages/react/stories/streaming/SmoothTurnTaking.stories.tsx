/**
 * Turn-taking gate integration suite (document-level smooth coordination).
 *
 * The unit layers prove the pieces in isolation — coordinator state machine
 * on microtasks, SSR/first-frame gate decision via renderToString — but the
 * gate's REAL contract lives across React commits: release arriving through
 * the coordinator's microtask fanout, the two-beat handshake staying two
 * commits under automatic batching, done reporting from live values, and
 * the single-cursor invariant. These stories drive that path end to end.
 *
 * Assertions are convergence-only: terminal `waitFor` states plus monotone
 * latches recorded while converging (a latch can only flip on genuine
 * evidence, so a slow runner can delay but never corrupt a verdict). No
 * assertion races the wall clock against reveal timing.
 */

import React, { StrictMode, useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import AIMarkdown, {
  AIMarkdownDocuments,
  AIMarkdownSmoothStream,
  AIMarkdownStreamingCursor,
  useDocumentSmoothStream,
} from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { WithScheme } from '../_shared/colorScheme';
import { getStreamingTheme } from './theme';

interface ChunkPhase {
  content: string;
  streaming: boolean;
}

interface ChunkStatus {
  visible: number;
  /** Source still producing OR reveal still animating. */
  busy: boolean;
}

/** Shared scoreboard: chunks report per-commit status keyed by `doc:index`
 *  so siblings (and the ordering check) can read a fresh cross-chunk view.
 *  A ref, not state — reporting must not re-render the tree. */
type Scoreboard = Map<string, ChunkStatus>;

const ScriptedChunk = ({
  doc,
  index,
  phase,
  board,
  onViolation,
  onPartial,
  onShrink,
  onDrained,
  flushProbeRef,
  onFlushUnstable,
  onGhostStreaming,
  pacing,
  theme,
}: {
  doc: string;
  index: number;
  phase: ChunkPhase;
  board: React.RefObject<Scoreboard>;
  /** A later chunk showed text while an earlier same-doc chunk was busy. */
  onViolation?: () => void;
  /** This chunk rendered a partial non-empty prefix (it ANIMATED). */
  onPartial?: () => void;
  /** This chunk's visible text got shorter (it was re-hidden). */
  onShrink?: () => void;
  onDrained?: () => void;
  /** Receives the latest `flush` so the script can press "skip". */
  flushProbeRef?: React.RefObject<(() => void) | null>;
  /** The returned `flush` changed identity between commits. */
  onFlushUnstable?: () => void;
  /** Returned `streaming` was true on a commit where the SOURCE had
   *  already stopped and nothing was left to reveal — a ghost cursor
   *  frame (the empty-chunk forced-beat regression). */
  onGhostStreaming?: () => void;
  pacing?: 'smooth' | 'balanced' | 'responsive';
  theme: 'light' | 'dark';
}) => {
  const smooth = useDocumentSmoothStream({
    documentId: doc,
    content: phase.content,
    streaming: phase.streaming,
    pacing,
    onDrained,
  });
  const prevVisibleRef = useRef(0);
  const prevFlushRef = useRef<(() => void) | null>(null);
  // Every-commit instrumentation (deliberately dep-less): the scoreboard
  // entry must be fresh for whoever commits next, and the latches below
  // fire at most a handful of times per run.
  useEffect(() => {
    const key = `${doc}:${index}`;
    board.current.set(key, {
      visible: smooth.content.length,
      busy: phase.streaming || smooth.streaming,
    });
    if (smooth.content.length > 0 && onViolation) {
      for (const [otherKey, status] of board.current) {
        const [otherDoc, otherIndex] = otherKey.split(':');
        if (otherDoc === doc && Number(otherIndex) < index && status.busy) {
          onViolation();
          break;
        }
      }
    }
    if (onPartial && smooth.content.length > 0 && smooth.content.length < phase.content.length) onPartial();
    if (onShrink && smooth.content.length < prevVisibleRef.current) onShrink();
    prevVisibleRef.current = smooth.content.length;
    if (flushProbeRef) flushProbeRef.current = smooth.flush;
    if (onFlushUnstable && prevFlushRef.current && prevFlushRef.current !== smooth.flush) onFlushUnstable();
    prevFlushRef.current = smooth.flush;
    if (onGhostStreaming && !phase.streaming && smooth.streaming && smooth.content === phase.content) {
      onGhostStreaming();
    }
  });
  return (
    <div data-chunk={`${doc}:${index}`}>
      <AIMarkdown {...smooth} documentId={doc} colorScheme={theme} streamingCursor={AIMarkdownStreamingCursor} />
    </div>
  );
};

/** Run a mount-anchored timer script; cleared on unmount. */
const useTimerScript = (steps: Array<[number, () => void]>) => {
  const stepsRef = useRef(steps);
  useEffect(() => {
    const timers = stepsRef.current.map(([ms, fn]) => window.setTimeout(fn, ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);
};

const C1_TEXT = 'First chunk streams a full sentence before anyone else may speak.';
const C2_TEXT = 'Second chunk waited its turn and only then revealed this line.';
const C3_TEXT = 'Third chunk speaks last.';

/**
 * Three chunks, sources streaming CONCURRENTLY (the server does not wait —
 * only the reveal does). The gate must serialize the reveals in mount order
 * with never more than one cursor.
 */
const TurnTakingHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phases, setPhases] = useState<ChunkPhase[]>([
    { content: '', streaming: true },
    { content: '', streaming: true },
    { content: '', streaming: true },
  ]);
  const patch = (i: number, phase: ChunkPhase) => setPhases((prev) => prev.map((p, k) => (k === i ? phase : p)));
  useTimerScript([
    [40, () => patch(0, { content: C1_TEXT.slice(0, 20), streaming: true })],
    [120, () => patch(0, { content: C1_TEXT, streaming: true })],
    [300, () => patch(0, { content: C1_TEXT, streaming: false })],
    // Chunk 2's and 3's sources complete while (typically) still gated.
    [80, () => patch(1, { content: C2_TEXT.slice(0, 12), streaming: true })],
    [200, () => patch(1, { content: C2_TEXT, streaming: true })],
    [380, () => patch(1, { content: C2_TEXT, streaming: false })],
    [150, () => patch(2, { content: C3_TEXT, streaming: true })],
    [420, () => patch(2, { content: C3_TEXT, streaming: false })],
  ]);
  const board = useRef<Scoreboard>(new Map());
  const [violations, setViolations] = useState(0);
  const [drains, setDrains] = useState(0);
  const allSourcesDone = phases.every((p) => !p.streaming);
  return (
    <div
      data-testid="turn-taking"
      data-violations={violations}
      data-drains={drains}
      data-sources-done={allSourcesDone ? 'yes' : 'no'}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdownDocuments>
        {phases.map((phase, i) => (
          <ScriptedChunk
            key={i}
            doc="doc"
            index={i}
            phase={phase}
            board={board}
            onViolation={() => setViolations((v) => v + 1)}
            onDrained={() => setDrains((d) => d + 1)}
            theme={theme}
          />
        ))}
      </AIMarkdownDocuments>
    </div>
  );
};

const meta: Meta<typeof TurnTakingHarness> = {
  title: 'Core/QA/Turn Taking',
  tags: ['qa'],
  component: TurnTakingHarness,
  parameters: {
    // Mid-reveal markup is nondeterministic by construction.
    chromatic: { disableSnapshot: true },
  },
};
export default meta;

type Story = StoryObj<typeof TurnTakingHarness>;

export const TurnTaking: Story = {
  // StrictMode on purpose: coordinator registration must survive the
  // dev-build effect replay (refcount + deferred reclaim) without ghost
  // queue slots that would deadlock the gate.
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StrictMode>
          <TurnTakingHarness theme={colorScheme} />
        </StrictMode>
      )}
    </WithScheme>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="turn-taking"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    // Latch the worst concurrent-cursor count observed while converging.
    let maxCursors = 0;
    await waitFor(
      () => {
        maxCursors = Math.max(maxCursors, root().querySelectorAll('[data-aimd-streaming-indicator]').length);
        expect(root().dataset.drains).toBe('3');
      },
      { timeout: 25_000 }
    );
    // Sequencing: no later chunk ever showed text while an earlier one was
    // still busy (source producing or reveal animating).
    expect(root().dataset.violations).toBe('0');
    // Single typewriter ⇒ never two cursors in the same frame.
    expect(maxCursors).toBeLessThanOrEqual(1);
    // Everything made it out through the gate.
    expect(root().textContent).toContain(C1_TEXT);
    expect(root().textContent).toContain(C2_TEXT);
    expect(root().textContent).toContain(C3_TEXT);
    expect(root().querySelector('[data-aimd-streaming-indicator]')).toBeNull();
  },
};

const LONG_FIRST =
  'The opening chunk keeps talking for a while so its successor is guaranteed to spend real time in the queue before its turn arrives.';
const QUEUED_FULL = 'This entire message arrived while gated and must still play out, not flash.';

/**
 * Main scenario: the queued chunk's source FINISHES while gated
 * (content complete, streaming already false). On release it must animate
 * through the drain law — the two-beat handshake regression: a collapsed
 * handshake (or a stale drain deadline) snaps it in one frame.
 *
 * Piggybacked contract pins (all on chunk 2, all while gated):
 * - its content is REPLACED (draft → regeneration) before release; the
 *   reveal only ever sees empty → final, so `onDrained` still fires;
 * - `flush()` mid-gate is a no-op (a reveal would trip the violation
 *   latch — chunk 1 is still busy at that point);
 * - the returned `flush` stays identity-stable across the whole
 *   gated → released → drained lifecycle.
 */
const ReleaseHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phases, setPhases] = useState<ChunkPhase[]>([
    { content: '', streaming: true },
    { content: '', streaming: true },
  ]);
  const patch = (i: number, phase: ChunkPhase) => setPhases((prev) => prev.map((p, k) => (k === i ? phase : p)));
  const flushProbeRef = useRef<(() => void) | null>(null);
  useTimerScript([
    [40, () => patch(0, { content: LONG_FIRST.slice(0, 30), streaming: true })],
    [180, () => patch(0, { content: LONG_FIRST, streaming: true })],
    [420, () => patch(0, { content: LONG_FIRST, streaming: false })],
    // A draft that will be REPLACED (not extended) while still gated.
    [60, () => patch(1, { content: 'Draft to be regenerated.', streaming: true })],
    // The replacement arrives COMPLETE, long before chunk 1 finishes.
    [140, () => patch(1, { content: QUEUED_FULL, streaming: false })],
    // Skip-animation pressed while gated: must reveal nothing (chunk 1 is
    // still busy — any reveal here trips the violation latch).
    [200, () => flushProbeRef.current?.()],
  ]);
  const board = useRef<Scoreboard>(new Map());
  const [violations, setViolations] = useState(0);
  const [partial, setPartial] = useState(false);
  const [drains, setDrains] = useState(0);
  const [flushUnstable, setFlushUnstable] = useState(false);
  return (
    <div
      data-testid="release"
      data-violations={violations}
      data-partial={partial ? 'yes' : 'no'}
      data-drains={drains}
      data-flush-unstable={flushUnstable ? 'yes' : 'no'}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdownDocuments>
        <ScriptedChunk
          doc="doc"
          index={0}
          phase={phases[0]}
          board={board}
          onViolation={() => setViolations((v) => v + 1)}
          theme={theme}
        />
        <ScriptedChunk
          doc="doc"
          index={1}
          phase={phases[1]}
          board={board}
          onViolation={() => setViolations((v) => v + 1)}
          onPartial={() => setPartial(true)}
          onDrained={() => setDrains((d) => d + 1)}
          flushProbeRef={flushProbeRef}
          onFlushUnstable={() => setFlushUnstable(true)}
          // 'smooth' widens the drain window (320ms vs 240ms): the partial
          // latch needs ≥1 commit inside it, so the wider window keeps a
          // briefly-stalled runner from collapsing the reveal into one
          // frame and turning the story spuriously red (fail-closed, but
          // noisy).
          pacing="smooth"
          theme={theme}
        />
      </AIMarkdownDocuments>
    </div>
  );
};

export const ReleaseAnimatesNotSnaps: Story = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StrictMode>
          <ReleaseHarness theme={colorScheme} />
        </StrictMode>
      )}
    </WithScheme>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="release"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    // The released chunk drains — through the fresh (beat-2) deadline. The
    // drain firing at all ALSO pins the replacement contract: chunk 2's
    // content was regenerated while gated, and gated replacements still
    // fire onDrained (the reveal only ever saw empty → final).
    await waitFor(() => expect(root().dataset.drains).toBe('1'), { timeout: 25_000 });
    // Zero violations also proves the mid-gate flush() was a no-op — a
    // reveal at that point (chunk 1 still busy) would have tripped it.
    expect(root().dataset.violations).toBe('0');
    // It ANIMATED: at least one commit showed a partial prefix. A snap
    // (collapsed handshake / stale deadline) goes 0 → full in one commit
    // and this latch stays 'no'.
    expect(root().dataset.partial).toBe('yes');
    // The regenerated text is what revealed (not the draft), and `flush`
    // kept one identity across gated → released → drained.
    expect(root().textContent).toContain(QUEUED_FULL);
    expect(root().textContent).not.toContain('Draft to be regenerated');
    expect(root().dataset.flushUnstable).toBe('no');
  },
};

const ROUND_ONE = 'Round one of the first chunk.';
const ROUND_TWO = ' Round two arrives after the successor already started.';
const SECOND_MSG = 'Successor text that must never be re-hidden.';

/**
 * Sticky done: after chunk 1 completes and chunk 2 starts revealing,
 * chunk 1 un-finishes (tool-call round 2). Re-gating chunk 2 — hiding
 * already-visible text — is the failure mode; overlap is the accepted
 * behavior.
 */
const StickyDoneHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phases, setPhases] = useState<ChunkPhase[]>([
    { content: '', streaming: true },
    { content: '', streaming: true },
  ]);
  const patch = (i: number, phase: ChunkPhase) => setPhases((prev) => prev.map((p, k) => (k === i ? phase : p)));
  useTimerScript([
    [40, () => patch(0, { content: ROUND_ONE, streaming: true })],
    [160, () => patch(0, { content: ROUND_ONE, streaming: false })],
    [80, () => patch(1, { content: SECOND_MSG, streaming: false })],
  ]);
  // Round 2 fires only once chunk 2 is visibly revealing — convergence-
  // driven, so the un-finish is GUARANTEED to land mid-successor-reveal.
  const [round2Sent, setRound2Sent] = useState(false);
  const [partial2, setPartial2] = useState(false);
  useEffect(() => {
    // One-shot, cleanup-free on purpose: a cleanup would be re-run by the
    // round2Sent flip and clear the settle timer before it fires. The
    // partial2 dep only ever flips false→true once, and the StrictMode
    // mount replay sees it still false, so the body runs exactly once.
    if (!partial2 || round2Sent) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot story-script latch
    setRound2Sent(true);
    patch(0, { content: ROUND_ONE + ROUND_TWO, streaming: true });
    window.setTimeout(() => patch(0, { content: ROUND_ONE + ROUND_TWO, streaming: false }), 120);
  }, [partial2, round2Sent]);
  const board = useRef<Scoreboard>(new Map());
  const [shrinks, setShrinks] = useState(0);
  const settled = phases.every((p) => !p.streaming) && round2Sent;
  return (
    <div
      data-testid="sticky-done"
      data-shrinks={shrinks}
      data-round2={round2Sent ? 'yes' : 'no'}
      data-sources-done={settled ? 'yes' : 'no'}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdownDocuments>
        <ScriptedChunk doc="doc" index={0} phase={phases[0]} board={board} theme={theme} />
        <ScriptedChunk
          doc="doc"
          index={1}
          phase={phases[1]}
          board={board}
          onPartial={() => setPartial2(true)}
          onShrink={() => setShrinks((s) => s + 1)}
          theme={theme}
        />
      </AIMarkdownDocuments>
    </div>
  );
};

export const StickyDoneNoRegate: Story = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StrictMode>
          <StickyDoneHarness theme={colorScheme} />
        </StrictMode>
      )}
    </WithScheme>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="sticky-done"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    await waitFor(() => expect(root().dataset.round2).toBe('yes'), { timeout: 25_000 });
    await waitFor(
      () => {
        expect(root().textContent).toContain(ROUND_TWO.trim());
        expect(root().textContent).toContain(SECOND_MSG);
      },
      { timeout: 25_000 }
    );
    // The successor's visible text never got shorter: the predecessor's
    // un-finish did not re-gate it.
    expect(root().dataset.shrinks).toBe('0');
  },
};

const AWAY_TEXT = 'A chunk that was scrolled away mid-stream keeps its words when it returns.';
const AFTER_TEXT = 'The successor may speak once the missing chunk left the queue.';

/**
 * Virtualization contract, both halves: unmounting a still-revealing chunk
 * releases its successors (no deadlock), and remounting it with the
 * accumulated content snaps instantly via mount pass-through (no replay,
 * no blanking).
 */
const VirtualizationHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [mounted1, setMounted1] = useState(true);
  const [phases, setPhases] = useState<ChunkPhase[]>([
    { content: '', streaming: true },
    { content: '', streaming: true },
  ]);
  const patch = (i: number, phase: ChunkPhase) => setPhases((prev) => prev.map((p, k) => (k === i ? phase : p)));
  useTimerScript([
    [40, () => patch(0, { content: AWAY_TEXT.slice(0, 24), streaming: true })],
    // Scroll away: chunk 1 unmounts while STILL streaming (never done).
    [200, () => setMounted1(false)],
    // Chunk 2's source streams and ends normally — the update→finish path,
    // so its drain (the release evidence) genuinely fires.
    [260, () => patch(1, { content: AFTER_TEXT, streaming: true })],
    [340, () => patch(1, { content: AFTER_TEXT, streaming: false })],
  ]);
  // Scroll back once the successor finished — with the full text, source
  // ended while off-screen (the recycled-list shape). Convergence-driven.
  const [drains2, setDrains2] = useState(0);
  useEffect(() => {
    if (drains2 !== 1 || mounted1) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot story-script step
    patch(0, { content: AWAY_TEXT, streaming: false });
    setMounted1(true);
  }, [drains2, mounted1]);
  const board = useRef<Scoreboard>(new Map());
  return (
    <div
      data-testid="virtualization"
      data-drains2={drains2}
      data-mounted1={mounted1 ? 'yes' : 'no'}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdownDocuments>
        {mounted1 && <ScriptedChunk doc="doc" index={0} phase={phases[0]} board={board} theme={theme} />}
        <ScriptedChunk
          doc="doc"
          index={1}
          phase={phases[1]}
          board={board}
          onDrained={() => setDrains2((d) => d + 1)}
          theme={theme}
        />
      </AIMarkdownDocuments>
    </div>
  );
};

export const VirtualizationScrollBack: Story = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StrictMode>
          <VirtualizationHarness theme={colorScheme} />
        </StrictMode>
      )}
    </WithScheme>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="virtualization"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    // The successor drained even though its predecessor never reported
    // done — unmount released it.
    await waitFor(() => expect(root().dataset.drains2).toBe('1'), { timeout: 25_000 });
    // Scroll-back: the remounted chunk's full text is present (mount
    // pass-through snap; a re-queued chunk would render '' here).
    await waitFor(
      () => {
        expect(root().dataset.mounted1).toBe('yes');
        expect(root().textContent).toContain(AWAY_TEXT);
      },
      { timeout: 25_000 }
    );
    expect(root().textContent).toContain(AFTER_TEXT);
  },
};

const A1 = 'Document A, first message, deliberately slow to finish.';
const A2 = 'Document A, second message.';
const B1 = 'Document B speaks immediately — it owes document A nothing.';

/**
 * Queues are per-documentId: B's first chunk mounts AFTER both A chunks in
 * tree order, yet must reveal while A1 is still busy. Only same-document
 * successors wait.
 */
const DualDocHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phases, setPhases] = useState<ChunkPhase[]>([
    { content: '', streaming: true }, // A1
    { content: '', streaming: true }, // A2
    { content: '', streaming: true }, // B1
  ]);
  const patch = (i: number, phase: ChunkPhase) => setPhases((prev) => prev.map((p, k) => (k === i ? phase : p)));
  useTimerScript([
    [40, () => patch(0, { content: A1.slice(0, 16), streaming: true })],
    [300, () => patch(0, { content: A1, streaming: true })],
    [600, () => patch(0, { content: A1, streaming: false })],
    [100, () => patch(1, { content: A2, streaming: false })],
    [60, () => patch(2, { content: B1, streaming: true })],
    [220, () => patch(2, { content: B1, streaming: false })],
  ]);
  const board = useRef<Scoreboard>(new Map());
  const [violations, setViolations] = useState(0);
  // Independence latch: B1 visibly revealing while A1 is still busy.
  const [parallel, setParallel] = useState(false);
  const [drains, setDrains] = useState(0);
  return (
    <div
      data-testid="dual-doc"
      data-violations={violations}
      data-parallel={parallel ? 'yes' : 'no'}
      data-drains={drains}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdownDocuments>
        <ScriptedChunk
          doc="doc-a"
          index={0}
          phase={phases[0]}
          board={board}
          onDrained={() => setDrains((d) => d + 1)}
          theme={theme}
        />
        <ScriptedChunk
          doc="doc-a"
          index={1}
          phase={phases[1]}
          board={board}
          onViolation={() => setViolations((v) => v + 1)}
          onDrained={() => setDrains((d) => d + 1)}
          theme={theme}
        />
        <ScriptedChunk
          doc="doc-b"
          index={0}
          phase={phases[2]}
          board={board}
          onDrained={() => setDrains((d) => d + 1)}
          onPartial={() => {
            if (board.current.get('doc-a:0')?.busy) setParallel(true);
          }}
          theme={theme}
        />
      </AIMarkdownDocuments>
    </div>
  );
};

export const DualDocumentIndependence: Story = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StrictMode>
          <DualDocHarness theme={colorScheme} />
        </StrictMode>
      )}
    </WithScheme>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="dual-doc"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    await waitFor(() => expect(root().dataset.drains).toBe('3'), { timeout: 25_000 });
    // Same-doc ordering held for A…
    expect(root().dataset.violations).toBe('0');
    // …while B started without waiting for A (cross-doc independence).
    expect(root().dataset.parallel).toBe('yes');
    expect(root().textContent).toContain(A1);
    expect(root().textContent).toContain(A2);
    expect(root().textContent).toContain(B1);
  },
};

const BEFORE_EMPTY_TEXT = 'A first chunk with real text, so the empty one is released mid-queue.';
const NEVER_TEXT = 'The successor drains even though its predecessor never produced a byte.';

/**
 * THE distinguishing scenario for value-derived done reporting (§4.5): a
 * chunk that mounts empty, whose stream ends without ever producing text.
 * It generates ZERO controller notifies — update('') is the identical-
 * string no-op, finish() has nothing to push — so any edge-driven done
 * report (onDrained / notify subscriber) never fires and wedges every
 * successor forever. Value-derived reporting marks it done from plain
 * values. Every other story's chunks all eventually carry text, so only
 * this one turns red if done reporting regresses to edge-driven.
 *
 * The empty chunk sits MID-queue so its release necessarily happens after
 * its own source ended — the construction for the ghost-cursor latch: an
 * unconditional forced beat would flash one frame of `streaming: true` on
 * an empty, already-finished chunk (the fix scopes the forced beat to
 * non-empty backlogs).
 */
const EmptyChunkHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phases, setPhases] = useState<ChunkPhase[]>([
    { content: '', streaming: true },
    { content: '', streaming: true },
    { content: '', streaming: true },
  ]);
  const patch = (i: number, phase: ChunkPhase) => setPhases((prev) => prev.map((p, k) => (k === i ? phase : p)));
  useTimerScript([
    [40, () => patch(0, { content: BEFORE_EMPTY_TEXT, streaming: true })],
    [150, () => patch(0, { content: BEFORE_EMPTY_TEXT, streaming: false })],
    // Chunk 2: the conditional message that never materializes — its
    // stream ends (before chunk 1 finishes revealing) with content ''.
    [100, () => patch(1, { content: '', streaming: false })],
    [60, () => patch(2, { content: NEVER_TEXT, streaming: true })],
    [200, () => patch(2, { content: NEVER_TEXT, streaming: false })],
  ]);
  const board = useRef<Scoreboard>(new Map());
  const [drains, setDrains] = useState(0);
  const [ghosts, setGhosts] = useState(0);
  return (
    <div
      data-testid="empty-chunk"
      data-drains={drains}
      data-ghosts={ghosts}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdownDocuments>
        <ScriptedChunk doc="doc" index={0} phase={phases[0]} board={board} theme={theme} />
        <ScriptedChunk
          doc="doc"
          index={1}
          phase={phases[1]}
          board={board}
          onGhostStreaming={() => setGhosts((g) => g + 1)}
          theme={theme}
        />
        <ScriptedChunk
          doc="doc"
          index={2}
          phase={phases[2]}
          board={board}
          onDrained={() => setDrains((d) => d + 1)}
          theme={theme}
        />
      </AIMarkdownDocuments>
    </div>
  );
};

export const EmptyChunkReportsDone: Story = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StrictMode>
          <EmptyChunkHarness theme={colorScheme} />
        </StrictMode>
      )}
    </WithScheme>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="empty-chunk"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    // The final chunk drains — possible only if the never-materialized
    // mid-queue chunk reported done despite zero controller notifies.
    await waitFor(() => expect(root().dataset.drains).toBe('1'), { timeout: 25_000 });
    expect(root().textContent).toContain(BEFORE_EMPTY_TEXT);
    expect(root().textContent).toContain(NEVER_TEXT);
    // The empty chunk's release never produced a ghost cursor frame
    // (streaming=true on a finished, empty chunk).
    expect(root().dataset.ghosts).toBe('0');
  },
};

const STUCK_TEXT = 'A chunk whose app forgot to flip streaming off — the wedge.';
const ESCAPED_TEXT = 'Opted out mid-gate: this text must appear despite the stuck predecessor.';
const STILL_GATED_TEXT = 'Still coordinated: this chunk keeps waiting its turn.';

/**
 * The escape hatch under the exact condition the docs recommend it for: a
 * WEDGED queue (predecessor's `streaming` stuck true). Flipping
 * `smoothCoordination={false}` on a gated chunk withdraws its coordinator
 * mid-gate — the sticky-release branch must un-wedge that chunk (before
 * the fix it stayed at ''/false forever), while the still-coordinated
 * sibling keeps waiting (per-chunk scope). Uses the SHELL end to end, so
 * the `smoothCoordination` prop wiring is on the tested path.
 */
const OptOutEscapeHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phases, setPhases] = useState<ChunkPhase[]>([
    { content: '', streaming: true },
    { content: '', streaming: true },
    { content: '', streaming: true },
  ]);
  const patch = (i: number, phase: ChunkPhase) => setPhases((prev) => prev.map((p, k) => (k === i ? phase : p)));
  const [optOut2, setOptOut2] = useState(false);
  useTimerScript([
    // Chunk 1 streams and its flag STAYS true (the app bug being escaped).
    [40, () => patch(0, { content: STUCK_TEXT, streaming: true })],
    [80, () => patch(1, { content: ESCAPED_TEXT, streaming: false })],
    [120, () => patch(2, { content: STILL_GATED_TEXT, streaming: false })],
    // The user reaches for the documented escape hatch on chunk 2.
    [300, () => setOptOut2(true)],
  ]);
  const [drains, setDrains] = useState(0);
  return (
    <div data-testid="opt-out" data-drains={drains} style={{ color: getStreamingTheme(theme).text }}>
      <button
        data-testid="end-first"
        style={{ display: 'none' }}
        onClick={() => patch(0, { content: STUCK_TEXT, streaming: false })}
      />
      <AIMarkdownDocuments>
        <AIMarkdownSmoothStream
          documentId="doc"
          content={phases[0].content}
          streaming={phases[0].streaming}
          colorScheme={theme}
          streamingCursor={AIMarkdownStreamingCursor}
        />
        <AIMarkdownSmoothStream
          documentId="doc"
          content={phases[1].content}
          streaming={phases[1].streaming}
          smoothCoordination={!optOut2}
          colorScheme={theme}
          streamingCursor={AIMarkdownStreamingCursor}
        />
        <AIMarkdownSmoothStream
          documentId="doc"
          content={phases[2].content}
          streaming={phases[2].streaming}
          onSmoothDrained={() => setDrains((d) => d + 1)}
          colorScheme={theme}
          streamingCursor={AIMarkdownStreamingCursor}
        />
      </AIMarkdownDocuments>
    </div>
  );
};

export const OptOutEscapesWedgedQueue: Story = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StrictMode>
          <OptOutEscapeHarness theme={colorScheme} />
        </StrictMode>
      )}
    </WithScheme>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="opt-out"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    // The opted-out chunk escapes the wedge (snap degradation — its source
    // already ended, so "coordination off" means "just show it").
    await waitFor(() => expect(root().textContent).toContain(ESCAPED_TEXT), { timeout: 25_000 });
    // Per-chunk scope: the still-coordinated sibling is STILL waiting
    // (chunk 1's flag is still stuck at this point).
    expect(root().textContent).not.toContain(STILL_GATED_TEXT);
    // Un-stick chunk 1; the coordinated queue then finishes normally.
    canvasElement.querySelector<HTMLButtonElement>('[data-testid="end-first"]')!.click();
    await waitFor(() => expect(root().dataset.drains).toBe('1'), { timeout: 25_000 });
    expect(root().textContent).toContain(STUCK_TEXT);
    expect(root().textContent).toContain(STILL_GATED_TEXT);
  },
};
