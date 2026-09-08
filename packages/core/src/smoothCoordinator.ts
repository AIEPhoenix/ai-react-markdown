/**
 * Turn-taking coordinator for smooth-streaming chunks that share a
 * `documentId` under `<AIMarkdownDocuments>`.
 *
 * Each `useDocumentSmoothStream` chunk registers here in mount order and
 * reports a sticky `done` (source stopped AND reveal drained). A chunk that
 * mounted with empty content stays gated until every REGISTERED chunk
 * earlier in the order is done — so the chunks read as one typewriter:
 * chunk N reveals completely, then chunk N+1 starts.
 *
 * The structure deliberately mirrors `documentRegistry`'s proven patterns
 * (chunkId-keyed refcount with microtask-deferred reclaim for Strict Mode,
 * monotonic version + microtask-coalesced subscriber fanout, `onEmpty`
 * container eviction) without touching the registry itself: the def
 * registry and this coordinator share only the `documentId` scope. Chunks
 * that never register (non-smooth chunks, opted-out chunks) simply do not
 * exist here and can never block a successor; an unmounting chunk leaves
 * the order, so a virtualized-away predecessor releases its successors by
 * construction.
 *
 * `lastProgressAt` is the reveal-progress heartbeat behind the dev-only
 * stuck-flag warning. Writes to it intentionally do NOT bump `version` and
 * do NOT fan out — stamping happens once per reveal frame, and a fanout to
 * every sibling chunk per frame would be a performance bug. Nothing
 * subscribes to it; the pending chunk's warning timer reads it on demand.
 *
 * @module components/smoothStream/coordinator
 */

export interface SmoothCoordinator {
  /** Chunk mount-order chunkId list. **Read-only** — mutation corrupts the
   *  release predicate for every successor. */
  readonly order: readonly string[];
  /** Chunk IDs that have reported done. Sticky: entries are only removed
   *  when the chunk unregisters. **Read-only.** */
  readonly done: ReadonlySet<string>;
  /** Reveal-progress heartbeat, ms timestamps from the reporting chunk's
   *  clock. Written WITHOUT a version bump (see module doc). */
  readonly lastProgressAt: ReadonlyMap<string, number>;
  /** Monotonic counter bumped by every gating-relevant mutation
   *  (register / unregister / done transition). */
  readonly version: number;

  subscribe(cb: () => void): () => void;

  /** Allocate (or refcount-reuse, for Strict Mode remounts) this chunk's
   *  slot at the current end of the mount order. */
  register(chunkId: string): void;
  /** Refcount decrement with microtask-deferred reclaim; the last release
   *  removes the chunk from the order (waking successors) and, when the
   *  coordinator empties, fires the container's `onEmpty`. */
  release(chunkId: string): void;
  /** Sticky, idempotent: the first call per chunk bumps the version; the
   *  transition is never retracted while the chunk stays mounted (a
   *  predecessor that un-finishes must not re-gate successors). */
  markDone(chunkId: string): void;
  /** Heartbeat stamp — no version bump, no fanout. */
  stampProgress(chunkId: string, at: number): void;
  /** True when every registered chunk BEFORE `chunkId` in the order has
   *  reported done. Unregistered predecessors don't exist here, so they
   *  never block. A `chunkId` that is not (yet) registered itself is
   *  treated as sitting AFTER every registered chunk — a pre-registration
   *  query must not release a chunk whose predecessors are still
   *  revealing. */
  isReleased(chunkId: string): boolean;
  /** The earliest not-done registered chunk before `chunkId`, or null.
   *  Read by the dev-only stuck-flag warning timer. */
  earliestBlockerOf(chunkId: string): string | null;
}

/** Widened internal view (parallel to `RegistryInternal`): implementation-
 *  private fields, exported for tests but not from the package barrel. */
export interface SmoothCoordinatorInternal extends SmoothCoordinator {
  _refcounts: Map<string, number>;
  _subscribers: Set<() => void>;
  _notifyScheduled: boolean;
  _notify(): void;
}

/**
 * Construct a coordinator. `onEmpty` fires synchronously from inside the
 * deferred-release microtask when the last chunk just left, so the
 * container can evict its `documentId → coordinator` map entry while the
 * state is quiescent (same contract as the registry's `onEmpty`).
 */
export function createSmoothCoordinator(onEmpty?: () => void): SmoothCoordinatorInternal {
  const order: string[] = [];
  const done = new Set<string>();
  const lastProgressAt = new Map<string, number>();

  const coord: SmoothCoordinatorInternal = {
    order,
    done,
    lastProgressAt,
    version: 0,
    _refcounts: new Map(),
    _subscribers: new Set(),
    _notifyScheduled: false,

    register(chunkId: string): void {
      const count = this._refcounts.get(chunkId) ?? 0;
      this._refcounts.set(chunkId, count + 1);
      if (count === 0 && !order.includes(chunkId)) {
        order.push(chunkId);
        this._notify();
      }
    },

    release(chunkId: string): void {
      const count = this._refcounts.get(chunkId);
      if (count === undefined) return;
      if (count > 1) {
        this._refcounts.set(chunkId, count - 1);
        return;
      }
      this._refcounts.set(chunkId, 0);
      queueMicrotask(() => {
        if (this._refcounts.get(chunkId) !== 0) return; // Strict Mode revived it
        this._refcounts.delete(chunkId);
        const idx = order.indexOf(chunkId);
        if (idx !== -1) order.splice(idx, 1);
        done.delete(chunkId);
        lastProgressAt.delete(chunkId);
        // Successors gated behind this chunk may now be releasable.
        this._notify();
        if (order.length === 0 && onEmpty) onEmpty();
      });
    },

    markDone(chunkId: string): void {
      if (done.has(chunkId)) return; // idempotent — repeat reports don't bump version
      done.add(chunkId);
      this._notify();
    },

    stampProgress(chunkId: string, at: number): void {
      lastProgressAt.set(chunkId, at);
    },

    isReleased(chunkId: string): boolean {
      for (const id of order) {
        if (id === chunkId) return true;
        if (!done.has(id)) return false;
      }
      // Not registered (yet): treated as after every registered chunk, so
      // reaching here means all of them are done.
      return true;
    },

    earliestBlockerOf(chunkId: string): string | null {
      for (const id of order) {
        if (id === chunkId) return null;
        if (!done.has(id)) return id;
      }
      return null;
    },

    subscribe(cb: () => void): () => void {
      this._subscribers.add(cb);
      return () => {
        this._subscribers.delete(cb);
      };
    },

    _notify(): void {
      (this as { version: number }).version++;
      if (this._notifyScheduled) return;
      this._notifyScheduled = true;
      queueMicrotask(() => {
        this._notifyScheduled = false;
        for (const cb of [...this._subscribers]) cb();
      });
    },
  };
  return coord;
}

/** Outcome of one stuck-flag warning timer firing (dev-only diagnostics). */
export type GateWarnVerdict = 'warn' | 'rearm' | 'clear';

/**
 * The warn / re-arm / clear decision behind the dev-only stuck-flag
 * warning, extracted as a pure function so the judgment is unit-testable
 * in node — the `setTimeout` wiring in `useDocumentSmoothStream` reduces
 * to "call this when the timer fires".
 *
 * - `'clear'`: no blocker left — the release is propagating; stop.
 * - `'rearm'`: the earliest blocker showed reveal progress within the
 *   threshold — a slow model still emitting, not a stuck flag; check
 *   again later.
 * - `'warn'`: the blocker has made no visible progress for a full
 *   threshold while this chunk stayed gated — the predecessor's
 *   `streaming` flag is likely stuck.
 */
export function evaluateGateWarn(
  coordinator: SmoothCoordinator,
  chunkId: string,
  nowMs: number,
  thresholdMs: number
): GateWarnVerdict {
  const blocker = coordinator.earliestBlockerOf(chunkId);
  if (!blocker) return 'clear';
  const progressedAt = coordinator.lastProgressAt.get(blocker) ?? 0;
  return nowMs - progressedAt < thresholdMs ? 'rearm' : 'warn';
}
