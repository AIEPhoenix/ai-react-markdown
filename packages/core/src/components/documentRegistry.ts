/**
 * Cross-chunk shared state. Holds per-chunk contributions (refs, defs,
 * linkDefs) keyed by Symbol identity allocated via useId reactId, with
 * refcount + microtask-deferred reclamation for React Strict Mode safety.
 *
 * @module components/documentRegistry
 */

import type { ElementContent as HastElementContent } from 'hast';
import { normalizeId } from './normalizeId';

export interface FootnoteDef {
  /** Already-normalized identifier (uppercase). Used as dictionary key for
   *  case-insensitive cross-chunk lookups. */
  identifier: string;
  /** mdast's case-folded identifier — the exact string mdast-util-to-hast
   *  emits in `<li id="${clobberPrefix}fn-${sourceIdentifier}">` and that
   *  `FootnoteSupNumber` mirrors in its anchor href. Needed so the aggregate
   *  footer's `<li id>` and backref href match the inline `<sup>`'s href
   *  exactly (otherwise hash navigation breaks). Optional so unit-test
   *  fixtures don't need to fabricate it; production data always supplies it. */
  sourceIdentifier?: string;
  /** Content extracted from the source markdown footnote definition. */
  contentSource: string;
  /** Per-def hast body (the def's mdast children after mdast-util-to-hast
   *  conversion). Drives AggregateFootnotesIfLast to render the consolidated
   *  footer at the end of each document's last chunk. Optional so unit-test
   *  fixtures can build minimal FootnoteDef objects without producing hast. */
  bodyHast?: HastElementContent[];
}

export interface LinkDef {
  /** Already-normalized identifier (uppercase). */
  identifier: string;
  url: string;
  title?: string;
}

export type RefKind = 'footnote' | 'link' | 'image';

export interface RefRecord {
  /** Already-normalized identifier (uppercase). */
  label: string;
  /** Which markdown reference space this entry belongs to. Footnote refs,
   *  link refs, and image refs occupy disjoint namespaces in GFM, so they
   *  must be filtered separately when computing footnote numbers / refcounts. */
  kind: RefKind;
  referenceType?: 'full' | 'collapsed' | 'shortcut';
}

export interface ChunkData {
  refs: RefRecord[];
  defs: Map<string, FootnoteDef>;
  linkDefs: Map<string, LinkDef>;
  ownFootnoteLabels: Set<string>;
  ownLinkLabels: Set<string>;
}

export interface Registry {
  /** Chunk mount-order Symbol list. **Read-only from outside the registry.**
   *  Direct mutation (`.push`, `.splice`, index assignment) corrupts
   *  footnote numbering, "last chunk" detection, and eviction. Use the
   *  `allocateSymbol` / `releaseSymbol` / `registerChunk` API instead. */
  readonly chunkOrder: readonly symbol[];
  /** Chunk Symbol → contribution payload. **Read-only from outside.**
   *  Use `contributeChunkData` / `contributeLabels` / `registerChunk` to
   *  publish; direct `.set` / `.delete` bypasses version bumps and
   *  subscriber wake-ups. */
  readonly chunkData: ReadonlyMap<symbol, ChunkData>;
  /** Union of own-def labels across all chunks. PASS 0.5 phantom-injection
   *  driver. **Read-only from outside.** The registry derives this from
   *  per-chunk contributions; direct mutation breaks the derivation. */
  readonly labelSet: {
    readonly footnoteLabels: ReadonlySet<string>;
    readonly linkLabels: ReadonlySet<string>;
  };
  /** Monotonic version counter bumped by every mutation. **Read-only from
   *  outside** — consumers should observe via `subscribe`, not by writing. */
  readonly version: number;

  // === API ===
  /** Allocate (or reuse, for Strict Mode remount) the chunk Symbol for
   *  `reactId` AND publish this chunk's own def labels (footnotes + links)
   *  in one call. Canonical pair API used by `MarkdownContent`'s allocate
   *  effect — combining the two reduces the pair to a single registry
   *  version step, which downstream consumers see as one wake-up rather
   *  than two (the second was already coalesced by microtask, but this
   *  keeps the version monotonic-by-1-per-mount which makes debugging
   *  easier). The granular `allocateSymbol` / `contributeLabels` methods
   *  remain available for tests that need to exercise each step. */
  registerChunk(reactId: string, footnotes: Set<string>, links: Set<string>): symbol;
  allocateSymbol(reactId: string): symbol;
  releaseSymbol(reactId: string): void;
  contributeLabels(symbol: symbol, footnotes: Set<string>, links: Set<string>): void;
  contributeChunkData(symbol: symbol, data: ChunkData): void;
  subscribe(cb: () => void): () => void;

  // Selectors (memoized internally by version).
  canonicalFootnoteFor(label: string): symbol | null;
  canonicalLinkFor(label: string): symbol | null;
  globalNumber(label: string): number | null;
  resolveLinkDef(label: string): LinkDef | null;
  getRefsForLabel(label: string): number;
  /** Map a chunk-local footnote-ref occurrence index (1-based, as emitted by
   *  `customMdastHandlers`) to the corresponding document-wide occurrence
   *  index across all chunks. Used by `FootnoteSupNumber` to build a unique
   *  `id="fnref-X-N"` for each ref instance and by `AggregateFootnotesIfLast`
   *  to enumerate per-occurrence backrefs. Returns `null` if the ref isn't
   *  registered yet (registry mid-flight). */
  globalOccurrenceForRef(chunkSym: symbol, label: string, localOccurrence: number): number | null;
}

/**
 * The shape actually realised inside `createRegistry`. Includes
 * implementation-private fields (reactId-keyed refcount table, subscriber
 * set, microtask-coalesce flag, `_notify` itself). Kept off the public
 * {@link Registry} interface so the dts emit doesn't leak mutable internals
 * — a consumer flipping `_notifyScheduled = true` would otherwise be able
 * to silently break the coalesce invariant.
 */
interface RegistryInternal extends Registry {
  _reactIdMap: Map<string, { symbol: symbol; refcount: number }>;
  _subscribers: Set<() => void>;
  _notifyScheduled: boolean;
  _notify(): void;
}

/**
 * Construct a new Registry. `onEmpty`, if supplied, is invoked once each
 * time the registry transitions to "no chunks alive" — i.e. the last
 * tracked chunk's deferred `releaseSymbol` cleanup just removed its
 * entry, leaving `chunkOrder` and `chunkData` both empty. The container
 * uses this to evict the registry from its `documentId → Registry` map
 * so long-lived SPAs that cycle through many `documentId` values don't
 * accumulate empty shells.
 *
 * `onEmpty` fires synchronously from inside the releaseSymbol microtask,
 * so the registry's state is guaranteed quiescent during the callback —
 * no other code can interleave between the empty-state check and the
 * caller's eviction logic.
 */
export function createRegistry(onEmpty?: () => void): Registry {
  const reg = {
    chunkOrder: [] as symbol[],
    chunkData: new Map<symbol, ChunkData>(),
    labelSet: { footnoteLabels: new Set<string>(), linkLabels: new Set<string>() },
    version: 0,
    _reactIdMap: new Map<string, { symbol: symbol; refcount: number }>(),
    _subscribers: new Set<() => void>(),
    _notifyScheduled: false,

    allocateSymbol(reactId: string): symbol {
      const existing = this._reactIdMap.get(reactId);
      if (existing) {
        existing.refcount++;
        return existing.symbol;
      }
      const sym = Symbol(reactId);
      this._reactIdMap.set(reactId, { symbol: sym, refcount: 1 });
      this.chunkOrder.push(sym);
      this._notify();
      return sym;
    },

    registerChunk(reactId: string, footnotes: Set<string>, links: Set<string>): symbol {
      // Composition of allocateSymbol + contributeLabels. Both `_notify`
      // calls coalesce into a single microtask wake-up, so the perf
      // shape is the same as the granular pair — the API just expresses
      // the canonical "register one chunk" intent.
      const sym = this.allocateSymbol(reactId);
      this.contributeLabels(sym, footnotes, links);
      return sym;
    },

    releaseSymbol(reactId: string): void {
      const entry = this._reactIdMap.get(reactId);
      if (!entry) return;
      entry.refcount--;
      if (entry.refcount === 0) {
        queueMicrotask(() => {
          const latest = this._reactIdMap.get(reactId);
          if (latest && latest.refcount === 0) {
            this._reactIdMap.delete(reactId);
            const idx = this.chunkOrder.indexOf(entry.symbol);
            if (idx !== -1) this.chunkOrder.splice(idx, 1);
            this.chunkData.delete(entry.symbol);
            // Rebuild labelSet from the surviving chunks. The contribute paths
            // (`contributeLabels`, `contributeChunkData`) already rebuild this
            // union on every write, but a chunk that simply UNMOUNTS would
            // otherwise leave `labelSet` referencing labels that no live chunk
            // owns. Downstream consumers (`targetPhantoms` in
            // `MarkdownContent`) read `registry.labelSet` to gate phantom
            // injection — without this rebuild, surviving chunks would keep
            // treating refs to the released chunk's labels as phantom, while
            // `canonicalFootnoteFor` (which walks live chunkData) returns
            // null, leaving inline `<sup>` anchors pointing at `<li>` ids
            // that the aggregate footer never renders.
            const nextFn = new Set<string>();
            const nextLink = new Set<string>();
            for (const cd of this.chunkData.values()) {
              for (const l of cd.ownFootnoteLabels) nextFn.add(l);
              for (const l of cd.ownLinkLabels) nextLink.add(l);
            }
            this.labelSet.footnoteLabels = nextFn;
            this.labelSet.linkLabels = nextLink;
            this._notify();
            // Last chunk just left: notify the container so it can drop
            // this registry from its `documentId → Registry` map. The
            // identity check on the container side prevents racing a
            // freshly-allocated registry under the same documentId.
            //
            // Ordering note: `onEmpty` fires SYNCHRONOUSLY here, after
            // `_notify` has scheduled subscriber fanout (which itself
            // runs in a later microtask, see `_notifyScheduled`). So
            // the container evicts FIRST, then subscribers wake. A
            // subscriber that re-resolves via `getRegistry(documentId)`
            // during its wake-up therefore sees a freshly-allocated
            // registry — which is the right behavior, because by then
            // the consumer is genuinely starting over.
            if (this.chunkOrder.length === 0 && this.chunkData.size === 0 && onEmpty) {
              onEmpty();
            }
          }
        });
      }
    },

    contributeLabels(symbol: symbol, footnotes: Set<string>, links: Set<string>): void {
      const data = this.chunkData.get(symbol);
      if (data) {
        data.ownFootnoteLabels = footnotes;
        data.ownLinkLabels = links;
      } else {
        this.chunkData.set(symbol, {
          refs: [],
          defs: new Map(),
          linkDefs: new Map(),
          ownFootnoteLabels: footnotes,
          ownLinkLabels: links,
        });
      }
      // Always notify. The prior `if (fnChanged || linkChanged)` optimization
      // skipped the wake-up when the UNION labelSet was unchanged — but
      // chunkData has ALWAYS mutated by the time we reach this line (we either
      // overwrote ownFootnoteLabels/ownLinkLabels on an existing entry, or we
      // just created a fresh chunkData entry above). A subscriber keyed on
      // `registry.version` would observe live chunkData changing under a
      // stable snapshot — a useSyncExternalStore tearing violation. With the
      // microtask-coalesced `_notify`, the per-call cost is the version++
      // plus a single subscriber fanout per batch, so the optimization's
      // savings are nil; correctness wins.
      const newFn = new Set<string>();
      const newLink = new Set<string>();
      for (const cd of this.chunkData.values()) {
        for (const l of cd.ownFootnoteLabels) newFn.add(l);
        for (const l of cd.ownLinkLabels) newLink.add(l);
      }
      this.labelSet.footnoteLabels = newFn;
      this.labelSet.linkLabels = newLink;
      this._notify();
    },

    contributeChunkData(symbol: symbol, data: ChunkData): void {
      this.chunkData.set(symbol, data);
      // Rebuild labelSet too (data may extend or shrink it)
      this.labelSet.footnoteLabels = new Set();
      this.labelSet.linkLabels = new Set();
      for (const cd of this.chunkData.values()) {
        for (const l of cd.ownFootnoteLabels) this.labelSet.footnoteLabels.add(l);
        for (const l of cd.ownLinkLabels) this.labelSet.linkLabels.add(l);
      }
      this._notify();
    },

    subscribe(cb: () => void): () => void {
      this._subscribers.add(cb);
      return () => {
        this._subscribers.delete(cb);
      };
    },

    canonicalFootnoteFor(label: string): symbol | null {
      const id = normalizeId(label);
      for (const sym of this.chunkOrder) {
        const data = this.chunkData.get(sym);
        if (data?.defs.has(id)) return sym;
      }
      return null;
    },

    canonicalLinkFor(label: string): symbol | null {
      const id = normalizeId(label);
      for (const sym of this.chunkOrder) {
        const data = this.chunkData.get(sym);
        if (data?.linkDefs.has(id)) return sym;
      }
      return null;
    },

    globalNumber(label: string): number | null {
      const id = normalizeId(label);
      let n = 0;
      const seen = new Set<string>();
      for (const sym of this.chunkOrder) {
        const data = this.chunkData.get(sym);
        if (!data) continue;
        for (const ref of data.refs) {
          // Footnote numbering is a per-space ordinal; link/image refs share
          // the `refs` array but occupy a disjoint namespace, so they must
          // NOT advance the footnote counter.
          if (ref.kind !== 'footnote') continue;
          if (!seen.has(ref.label)) {
            seen.add(ref.label);
            n++;
            if (ref.label === id) return n;
          }
        }
      }
      return null;
    },

    resolveLinkDef(label: string): LinkDef | null {
      const sym = this.canonicalLinkFor(label);
      if (!sym) return null;
      return this.chunkData.get(sym)?.linkDefs.get(normalizeId(label)) ?? null;
    },

    getRefsForLabel(label: string): number {
      const id = normalizeId(label);
      let n = 0;
      for (const sym of this.chunkOrder) {
        const data = this.chunkData.get(sym);
        if (!data) continue;
        // Only count footnote refs: the consumers (backref-strip and
        // backref-inject) decide based on whether a footnote `<li>` should
        // exist, which depends on footnote refs alone.
        for (const ref of data.refs) {
          if (ref.kind === 'footnote' && ref.label === id) n++;
        }
      }
      return n;
    },

    globalOccurrenceForRef(chunkSym: symbol, label: string, localOccurrence: number): number | null {
      const id = normalizeId(label);
      let global = 0;
      for (const sym of this.chunkOrder) {
        const data = this.chunkData.get(sym);
        if (!data) continue;
        let localCount = 0;
        for (const ref of data.refs) {
          if (ref.kind !== 'footnote') continue;
          if (ref.label !== id) continue;
          localCount++;
          global++;
          if (sym === chunkSym && localCount === localOccurrence) return global;
        }
      }
      return null;
    },

    _notify(): void {
      this.version++;
      if (this._notifyScheduled) return;
      this._notifyScheduled = true;
      queueMicrotask(() => {
        this._notifyScheduled = false;
        // Snapshot subscribers so unsubscribes during fanout don't shift the
        // iteration. New subscribers added during fanout will pick up the
        // current `version` on their next render.
        for (const cb of [...this._subscribers]) cb();
      });
    },
  };
  // Internally `reg` has both the public API and the private state.
  // The return type narrows to the public {@link Registry} so the dts
  // emit doesn't expose `_reactIdMap` / `_subscribers` / `_notifyScheduled` /
  // `_notify` — those are operational invariants, not API surface.
  return reg as unknown as RegistryInternal as Registry;
}
