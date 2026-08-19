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

/**
 * Public, read-only view of the cross-chunk registry. This is the type
 * surfaced by `useDocumentRegistry` and re-exported from the package
 * barrel. Consumers can:
 *
 *   - read the registry's current state (`chunkOrder`, `chunkData`,
 *     `labelSet`, `version`)
 *   - observe changes (`subscribe`)
 *   - run selectors (`globalNumber`, `resolveLinkDef`, …)
 *
 * Mutators — `registerChunk`, `allocateSymbol`, `releaseSymbol`,
 * `contributeLabels`, `contributeChunkData` — are intentionally off this
 * interface. Driving the registry directly is reserved for internal
 * coordinators (the package's own `MarkdownContent` renderer) and tests,
 * which import the wider `RegistryInternal` type from this module.
 * `RegistryInternal` is exported from this engine package (the core
 * renderer consumes it) but NOT from `@ai-react-markdown/core`'s public
 * barrel — keeping mutators off the consumer-facing surface prevents a
 * misbehaving consumer-component from corrupting refcounts, skipping
 * version bumps, or otherwise breaking the invariants the renderer relies
 * on.
 */
export interface Registry {
  /** Chunk mount-order Symbol list. **Read-only.** Direct mutation
   *  (`.push`, `.splice`, index assignment) corrupts footnote numbering,
   *  "last chunk" detection, and eviction. */
  readonly chunkOrder: readonly symbol[];
  /** Chunk Symbol → contribution payload. **Read-only.** Direct `.set` /
   *  `.delete` bypasses version bumps and subscriber wake-ups. */
  readonly chunkData: ReadonlyMap<symbol, ChunkData>;
  /** Union of own-def labels across all chunks. PASS 0.5 phantom-injection
   *  driver. **Read-only.** The registry derives this from per-chunk
   *  contributions; direct mutation breaks the derivation. */
  readonly labelSet: {
    readonly footnoteLabels: ReadonlySet<string>;
    readonly linkLabels: ReadonlySet<string>;
  };
  /** Monotonic version counter bumped by every mutation. **Read-only** —
   *  consumers should observe via `subscribe`, not by writing. */
  readonly version: number;

  subscribe(cb: () => void): () => void;

  // Selectors — pure reads over chunkOrder × chunkData, recomputed on every
  // call (NOT memoized: each is a linear walk of the registry; placeholder
  // components already gate their re-renders on `version`, so callers pay
  // one walk per registry mutation, not per render).
  canonicalFootnoteFor(label: string): symbol | null;
  canonicalLinkFor(label: string): symbol | null;
  globalNumber(label: string): number | null;
  /**
   * Resolve a cross-chunk link definition by label. The returned `url` is
   * the RAW destination from the contributing chunk's source — the registry
   * does not sanitize. The library's cross-chunk link/image placeholders run
   * the full per-attribute sanitization (`sanitizeSchema.protocols` +
   * `urlTransform`, correct key) at render time.
   *
   * Consumers reading `def.url` directly (custom backlink panels, analytics,
   * dev tooling) MUST run their own policy before rendering it as an
   * `href`/`src` — a chunk can define `[evil]: javascript:alert(1)`.
   */
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
 * Internal registry surface — extends {@link Registry} with the mutator
 * methods and implementation-private fields (reactId-keyed refcount table,
 * subscriber set, microtask-coalesce flag, `_notify` itself).
 *
 * Exported from this module (and the engine barrel) so internal
 * coordinators (`MarkdownContent`) and tests can hold a strongly-typed
 * reference, but **not** re-exported from `@ai-react-markdown/core`'s
 * barrel — a consumer flipping `_notifyScheduled = true`
 * or pushing into `chunkOrder` directly would silently break the
 * coalesce / numbering invariants. The runtime value returned by
 * {@link createRegistry} always satisfies this wider shape; public consumers
 * just see the narrowed {@link Registry} view.
 */
export interface RegistryInternal extends Registry {
  /** Allocate (or reuse, for Strict Mode remount) the chunk Symbol for
   *  `reactId` AND publish this chunk's own def labels (footnotes + links)
   *  in one call. Canonical pair API used by `MarkdownContent`'s allocate
   *  effect — combining the two reduces the pair to a single registry
   *  version step, which downstream consumers see as one wake-up rather
   *  than two (the second was already coalesced by microtask, but this
   *  keeps the version monotonic-by-1-per-mount which makes debugging
   *  easier). The granular `allocateSymbol` / `contributeLabels` methods
   *  remain available for tests that need to exercise each step. */
  registerChunk(reactId: string, footnotes: Set<string>, links: Set<string>, documentIndex?: number): symbol;
  /** `documentIndex` — the chunk's position in the DOCUMENT (not its mount
   *  order). Without it a chunk joins `chunkOrder` at the end, which is
   *  wrong for any list that unmounts and remounts chunks: a virtualized
   *  transcript scrolling back re-registers an earlier chunk after the ones
   *  still mounted, and footnote numbering plus "which chunk renders the
   *  aggregate footer" follow that order (2026-08-19 review r2 P2-10).
   *  Chunks that supply an index are kept sorted by it; chunks without one
   *  keep mount order after them. */
  allocateSymbol(reactId: string, documentIndex?: number): symbol;
  releaseSymbol(reactId: string): void;
  contributeLabels(symbol: symbol, footnotes: Set<string>, links: Set<string>): void;
  contributeChunkData(symbol: symbol, data: ChunkData): void;

  _reactIdMap: Map<string, { symbol: symbol; refcount: number }>;
  /** Symbol → the `documentIndex` its chunk supplied (see allocateSymbol). */
  _chunkIndex: Map<symbol, number>;
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
export function createRegistry(onEmpty?: () => void): RegistryInternal {
  const reg = {
    chunkOrder: [] as symbol[],
    chunkData: new Map<symbol, ChunkData>(),
    labelSet: { footnoteLabels: new Set<string>(), linkLabels: new Set<string>() },
    version: 0,
    _reactIdMap: new Map<string, { symbol: symbol; refcount: number }>(),
    /** Symbol → its `documentIndex`, for chunks that supplied one. */
    _chunkIndex: new Map<symbol, number>(),
    _subscribers: new Set<() => void>(),
    _notifyScheduled: false,

    allocateSymbol(reactId: string, documentIndex?: number): symbol {
      const existing = this._reactIdMap.get(reactId);
      if (existing) {
        existing.refcount++;
        return existing.symbol;
      }
      const sym = Symbol(reactId);
      this._reactIdMap.set(reactId, { symbol: sym, refcount: 1 });
      if (documentIndex === undefined) {
        // Mount order — the historical behaviour, and correct whenever
        // chunks mount once in document order.
        this.chunkOrder.push(sym);
      } else {
        this._chunkIndex.set(sym, documentIndex);
        // Insert before the first chunk that sits later in the document.
        // A chunk WITHOUT an index counts as "later" so an indexed chunk
        // never lands behind one whose position is unknown.
        let at = this.chunkOrder.length;
        for (let i = 0; i < this.chunkOrder.length; i++) {
          const other = this._chunkIndex.get(this.chunkOrder[i]);
          if (other === undefined || other > documentIndex) {
            at = i;
            break;
          }
        }
        this.chunkOrder.splice(at, 0, sym);
      }
      this._notify();
      return sym;
    },

    registerChunk(reactId: string, footnotes: Set<string>, links: Set<string>, documentIndex?: number): symbol {
      // Composition of allocateSymbol + contributeLabels. Both `_notify`
      // calls coalesce into a single microtask wake-up, so the perf
      // shape is the same as the granular pair — the API just expresses
      // the canonical "register one chunk" intent.
      const sym = this.allocateSymbol(reactId, documentIndex);
      this.contributeLabels(sym, footnotes, links);
      return sym;
    },

    releaseSymbol(reactId: string): void {
      const entry = this._reactIdMap.get(reactId);
      if (!entry) return;
      if (entry.refcount <= 0) {
        // Already fully released and awaiting the deferred cleanup (or a
        // caller released more than it allocated). Decrementing further
        // would park the refcount below zero, where the `=== 0` cleanup
        // check never fires and the chunk leaks forever with onEmpty
        // eviction disabled (2026-08 project review, eng-stream-03).
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[ai-react-markdown] Registry.releaseSymbol("${reactId}") called with no matching allocateSymbol — ignoring (unbalanced release).`
          );
        }
        return;
      }
      entry.refcount--;
      if (entry.refcount === 0) {
        queueMicrotask(() => {
          const latest = this._reactIdMap.get(reactId);
          if (latest && latest.refcount === 0) {
            this._reactIdMap.delete(reactId);
            const idx = this.chunkOrder.indexOf(entry.symbol);
            if (idx !== -1) this.chunkOrder.splice(idx, 1);
            this._chunkIndex.delete(entry.symbol);
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
      // A released or never-allocated symbol must not grow chunkData: the
      // ghost entry would keep `chunkData.size === 0` from ever holding and
      // the registry would never be evicted (v2.4.1 review). Effects racing
      // an unmount can legitimately land here — ignore, do not throw.
      if (!this.chunkOrder.includes(symbol)) return;
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
      if (!this.chunkOrder.includes(symbol)) return; // see contributeLabels
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
  // The return type is {@link RegistryInternal} so internal callers
  // (`MarkdownContent`, tests) hold a strongly-typed handle to the
  // mutators and private state. Public consumers see only the narrow
  // {@link Registry} via `useDocumentRegistry`'s return type.
  return reg as unknown as RegistryInternal;
}
