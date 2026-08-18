import { describe, test, expect } from 'vitest';
import { createRegistry, type Registry } from './documentRegistry';

// Compile-time guards that the exported `Registry` interface forbids direct
// mutation of its structural fields AND forbids access to the internal
// mutator methods (`registerChunk`, `allocateSymbol`, …). The previous
// shape (`chunkOrder: symbol[]` plus public mutators) let a downstream
// consumer corrupt footnote numbering and registry eviction by `.push`-ing
// rogue symbols, `.set`-ing chunkData entries, or driving the API
// directly. These `@ts-expect-error` lines fail if either contract regresses.
function _readonlyContractGuard(_reg: Registry): void {
  // --- Readonly structural fields ---
  // @ts-expect-error chunkOrder is `readonly symbol[]` — push() removed.
  _reg.chunkOrder.push(Symbol('rogue'));
  // @ts-expect-error chunkData is `ReadonlyMap` — set() removed.
  _reg.chunkData.set(Symbol('rogue'), {} as never);
  // @ts-expect-error labelSet is fully readonly — footnoteLabels.add() removed.
  _reg.labelSet.footnoteLabels.add('X');
  // @ts-expect-error version is `readonly number` — assignment removed.
  _reg.version = 999;
  // --- Mutator methods live on RegistryInternal, NOT on the public Registry ---
  // @ts-expect-error registerChunk is on RegistryInternal — not the public surface.
  _reg.registerChunk('rogue', new Set(), new Set());
  // @ts-expect-error allocateSymbol is on RegistryInternal — not the public surface.
  _reg.allocateSymbol('rogue');
  // @ts-expect-error releaseSymbol is on RegistryInternal — not the public surface.
  _reg.releaseSymbol('rogue');
  // @ts-expect-error contributeLabels is on RegistryInternal — not the public surface.
  _reg.contributeLabels(Symbol('rogue'), new Set(), new Set());
  // @ts-expect-error contributeChunkData is on RegistryInternal — not the public surface.
  _reg.contributeChunkData(Symbol('rogue'), {} as never);
  // @ts-expect-error private state never appears on Registry.
  _reg._notify();
}
void _readonlyContractGuard;

describe('Registry — Symbol allocation', () => {
  test('allocate same reactId twice returns same Symbol; refcount tracks both', () => {
    const reg = createRegistry();
    const s1 = reg.allocateSymbol('react-id-1');
    const s2 = reg.allocateSymbol('react-id-1');
    expect(s1).toBe(s2);
    expect(reg.chunkOrder.length).toBe(1);
  });

  test('release once: refcount drops but Symbol NOT immediately removed (microtask defer)', async () => {
    const reg = createRegistry();
    reg.allocateSymbol('react-id-1');
    reg.releaseSymbol('react-id-1');
    // Synchronously: chunkOrder still has the Symbol
    expect(reg.chunkOrder.length).toBe(1);
    // After microtask: Symbol cleared
    await new Promise<void>((r) => queueMicrotask(r));
    expect(reg.chunkOrder.length).toBe(0);
  });

  test('an unbalanced extra release is ignored — refcount never goes negative, cleanup still fires (eng-stream-03)', async () => {
    const reg = createRegistry();
    reg.allocateSymbol('react-id-1');
    reg.releaseSymbol('react-id-1');
    reg.releaseSymbol('react-id-1'); // one too many — must not park refcount at -1
    await new Promise<void>((r) => queueMicrotask(r));
    expect(reg.chunkOrder.length).toBe(0); // the deferred cleanup still ran
    // A fresh allocate after that mints a live entry again (no leaked -1).
    const sym = reg.allocateSymbol('react-id-1');
    expect(reg.chunkOrder).toEqual([sym]);
  });

  test('Strict Mode unmount-remount cycle preserves Symbol identity', async () => {
    const reg = createRegistry();
    const s1 = reg.allocateSymbol('react-id-1');
    reg.releaseSymbol('react-id-1'); // synthetic unmount
    const s2 = reg.allocateSymbol('react-id-1'); // immediate remount before microtask drains
    await new Promise<void>((r) => queueMicrotask(r));
    expect(s2).toBe(s1);
    expect(reg.chunkOrder.length).toBe(1);
  });

  test('allocate order preserved across chunks', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    const c = reg.allocateSymbol('C');
    expect(reg.chunkOrder).toEqual([a, b, c]);
  });

  test('registerChunk allocates and contributes labels in one call', async () => {
    // The canonical pair API MarkdownContent uses in its allocate effect:
    // one method covers both the Symbol mint and the initial label publish.
    const reg = createRegistry();
    const sym = reg.registerChunk('A', new Set(['X', 'Y']), new Set(['Z']));
    // Symbol is allocated and tracked.
    expect(reg.chunkOrder).toEqual([sym]);
    // chunkData entry exists with the contributed labels.
    const data = reg.chunkData.get(sym);
    expect(data?.ownFootnoteLabels).toEqual(new Set(['X', 'Y']));
    expect(data?.ownLinkLabels).toEqual(new Set(['Z']));
    // Union labelSet picked up the labels.
    expect(reg.labelSet.footnoteLabels).toEqual(new Set(['X', 'Y']));
    expect(reg.labelSet.linkLabels).toEqual(new Set(['Z']));
    // Subscribers fire at most once thanks to microtask coalesce.
    let wakeCount = 0;
    reg.subscribe(() => {
      wakeCount++;
    });
    reg.registerChunk('B', new Set(['Q']), new Set());
    await new Promise<void>((r) => queueMicrotask(() => r()));
    expect(wakeCount).toBe(1);
  });

  test('onEmpty fires exactly once when the last chunk releases', async () => {
    let emptyCount = 0;
    const reg = createRegistry(() => {
      emptyCount++;
    });
    reg.allocateSymbol('A');
    reg.allocateSymbol('B');
    // Two chunks alive: releasing A leaves B, no transition to empty.
    reg.releaseSymbol('A');
    await new Promise<void>((r) => queueMicrotask(r));
    expect(emptyCount).toBe(0);
    // Releasing B is the last release — transitions to empty.
    reg.releaseSymbol('B');
    await new Promise<void>((r) => queueMicrotask(r));
    expect(emptyCount).toBe(1);
    // chunkOrder and chunkData are both drained.
    expect(reg.chunkOrder).toEqual([]);
    expect(reg.chunkData.size).toBe(0);
  });

  test('v2.4.1 review: contributing under a released symbol is ignored, so the registry still empties', async () => {
    let emptyCount = 0;
    const reg = createRegistry(() => {
      emptyCount++;
    });
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    reg.releaseSymbol('A');
    await new Promise<void>((r) => queueMicrotask(r));
    // A late effect of the unmounted chunk contributes with its dead symbol.
    reg.contributeLabels(a, new Set(['x']), new Set());
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['x']),
      ownLinkLabels: new Set(),
    });
    expect(reg.chunkData.has(a)).toBe(false);
    expect(reg.labelSet.footnoteLabels.has('x')).toBe(false);
    // A never-allocated symbol is ignored too.
    reg.contributeLabels(Symbol('ghost'), new Set(['g']), new Set());
    expect(reg.labelSet.footnoteLabels.has('g')).toBe(false);
    // The live chunk still contributes normally.
    reg.contributeLabels(b, new Set(['y']), new Set());
    expect(reg.labelSet.footnoteLabels.has('y')).toBe(true);
    reg.releaseSymbol('B');
    await new Promise<void>((r) => queueMicrotask(r));
    expect(emptyCount).toBe(1);
    expect(reg.chunkData.size).toBe(0);
  });

  test('onEmpty does NOT fire when a partial release leaves refcount > 0', async () => {
    // allocateSymbol the same reactId twice → refcount=2 (Strict-Mode +
    // intentional double-mount, or just two callers sharing an id). One
    // releaseSymbol drops to 1, no microtask queued at all because of
    // the early-exit at `if (entry.refcount === 0)`. onEmpty stays cold.
    let emptyCount = 0;
    const reg = createRegistry(() => {
      emptyCount++;
    });
    reg.allocateSymbol('shared');
    reg.allocateSymbol('shared');
    reg.releaseSymbol('shared'); // refcount 2 → 1
    await new Promise<void>((r) => queueMicrotask(r));
    expect(emptyCount).toBe(0);
    expect(reg.chunkOrder.length).toBe(1);
  });

  test('after onEmpty fires, a fresh registerChunk on the same reactId mints a NEW Symbol', async () => {
    // Post-eviction the registry is meant to be discarded by the container,
    // but if a stray caller hangs on to the reference and registers again
    // under the same reactId, `_reactIdMap.delete` has cleared the slot —
    // so a fresh Symbol is minted, not the old one. Locks the contract.
    const reg = createRegistry();
    const s1 = reg.registerChunk('R', new Set(), new Set());
    reg.releaseSymbol('R');
    await new Promise<void>((r) => queueMicrotask(r));
    // Post-cleanup: chunkOrder is empty.
    expect(reg.chunkOrder).toEqual([]);
    const s2 = reg.registerChunk('R', new Set(), new Set());
    expect(s2).not.toBe(s1);
    expect(reg.chunkOrder).toEqual([s2]);
  });

  test('labelSet rebuilds when a defining chunk releases (no stale union)', async () => {
    // Bug class: releaseSymbol previously deleted from chunkOrder + chunkData
    // but did NOT rebuild labelSet. A surviving chunk reading
    // `registry.labelSet.footnoteLabels` would see labels that no live chunk
    // owns, causing downstream phantom injection / aggregate footer logic
    // to misbehave (inline <sup>'s pointing at <li> ids that don't exist).
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    reg.contributeLabels(a, new Set(['X']), new Set(['L1']));
    reg.contributeLabels(b, new Set(['Y']), new Set([]));
    expect(reg.labelSet.footnoteLabels).toEqual(new Set(['X', 'Y']));
    expect(reg.labelSet.linkLabels).toEqual(new Set(['L1']));
    // Release the chunk that owns X + L1; labelSet should shed BOTH.
    reg.releaseSymbol('A');
    await new Promise<void>((r) => queueMicrotask(r));
    expect(reg.labelSet.footnoteLabels).toEqual(new Set(['Y']));
    expect(reg.labelSet.linkLabels).toEqual(new Set());
    // Surviving chunk's labels still present.
    expect(reg.chunkData.get(b)?.ownFootnoteLabels).toEqual(new Set(['Y']));
  });

  test('onEmpty does NOT fire during a Strict-Mode remount cycle', async () => {
    // Cleanup runs between mount1 and mount2; refcount briefly hits 0 but
    // the remount restores it before the cleanup microtask drains. The
    // refcount-recheck path means no eviction-side callback should fire.
    let emptyCount = 0;
    const reg = createRegistry(() => {
      emptyCount++;
    });
    reg.allocateSymbol('R'); // mount 1
    reg.releaseSymbol('R'); // synthetic unmount
    reg.allocateSymbol('R'); // mount 2 (beats microtask)
    await new Promise<void>((r) => queueMicrotask(r));
    expect(emptyCount).toBe(0);
    expect(reg.chunkOrder.length).toBe(1);
  });

  test('registerChunk reuses the symbol on remount with the same reactId', () => {
    // Strict Mode double-mount path: the cleanup between the two mounts
    // bumps refcount down and queues a microtask delete; the second mount
    // beats the microtask and reuses the entry. registerChunk inherits
    // that behavior from allocateSymbol.
    const reg = createRegistry();
    const s1 = reg.registerChunk('R', new Set(['X']), new Set());
    const s2 = reg.registerChunk('R', new Set(['X']), new Set());
    expect(s1).toBe(s2);
    expect(reg.chunkOrder).toEqual([s1]);
  });
});

describe('Registry — contribute + selectors', () => {
  test('contributeLabels merges into labelSet across chunks', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    reg.contributeLabels(a, new Set(['X']), new Set([]));
    reg.contributeLabels(b, new Set(['Y']), new Set(['Z']));
    expect(reg.labelSet.footnoteLabels).toEqual(new Set(['X', 'Y']));
    expect(reg.labelSet.linkLabels).toEqual(new Set(['Z']));
  });

  test('globalNumber assigns by chunkOrder ref-first-occurrence', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    reg.contributeChunkData(a, {
      refs: [
        { label: 'X', kind: 'footnote' },
        { label: 'Y', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    reg.contributeChunkData(b, {
      refs: [
        { label: 'Z', kind: 'footnote' },
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    expect(reg.globalNumber('X')).toBe(1);
    expect(reg.globalNumber('Y')).toBe(2);
    expect(reg.globalNumber('Z')).toBe(3);
    expect(reg.globalNumber('NOPE')).toBe(null);
  });

  test('canonicalFootnoteFor picks first chunk with the def', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    reg.contributeChunkData(b, {
      refs: [],
      defs: new Map([['X', { identifier: 'X', contentSource: 'content from B' }]]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    expect(reg.canonicalFootnoteFor('X')).toBe(reg.chunkOrder[1]); // B's symbol
    expect(reg.canonicalFootnoteFor('Y')).toBe(null);
  });

  test('resolveLinkDef returns def from canonical chunk', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map([['X', { identifier: 'X', url: 'https://example.com' }]]),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(['X']),
    });
    const def = reg.resolveLinkDef('x'); // lowercase input — should normalize and match
    expect(def?.url).toBe('https://example.com');
  });

  test('selectors resolve a PADDED / soft-broken label to the trimmed def key (eng-stream-01)', () => {
    // Placeholders pass mdast's ORIGINAL `label` (`[ x ]`, `[x\ny]`); the
    // def is keyed by the trimmed identifier. normalizeId used to skip the
    // trim, so `' X '` missed `'X'` and every padded ref fell back to text.
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map([['X', { identifier: 'X', contentSource: 'b', bodyHast: [] }]]),
      linkDefs: new Map([['X Y', { identifier: 'X Y', url: 'https://example.com/xy' }]]),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(['X Y']),
    });
    expect(reg.resolveLinkDef(' x\ny ')?.url).toBe('https://example.com/xy');
    expect(reg.canonicalLinkFor('\tx  y')).toBe(a);
    expect(reg.canonicalFootnoteFor(' x ')).toBe(a);
    expect(reg.globalNumber(' x ')).toBe(1);
  });

  test('globalNumber counts ONLY footnote refs (link/image refs occupy a separate namespace)', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    // Interleave a link ref BETWEEN two footnote refs. Pre-fix, link refs
    // bumped the footnote counter, producing Y → 3 instead of Y → 2.
    reg.contributeChunkData(a, {
      refs: [
        { label: 'X', kind: 'footnote' },
        { label: 'LINK1', kind: 'link', referenceType: 'full' },
        { label: 'Y', kind: 'footnote' },
        { label: 'IMG1', kind: 'image', referenceType: 'full' },
        { label: 'Z', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    expect(reg.globalNumber('X')).toBe(1);
    expect(reg.globalNumber('Y')).toBe(2);
    expect(reg.globalNumber('Z')).toBe(3);
    // Querying a link label returns null — link refs don't get footnote numbers.
    expect(reg.globalNumber('LINK1')).toBe(null);
  });

  test('getRefsForLabel counts ONLY footnote refs', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [
        { label: 'X', kind: 'footnote' },
        { label: 'X', kind: 'link', referenceType: 'full' }, // same label, different namespace
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    expect(reg.getRefsForLabel('X')).toBe(2); // 2 footnote refs, not 3
  });

  test('contributeLabels always notifies (chunkData mutates on every call)', async () => {
    // Previously this test asserted that contributeLabels skipped `_notify`
    // when the union labelSet was unchanged — a perf optimization. That was
    // incorrect: `chunkData` is ALWAYS mutated by contributeLabels (we either
    // overwrite an existing chunk's ownLabels or create a fresh chunkData
    // entry), so a subscriber keyed on `registry.version` would observe
    // chunkData changing under a stable snapshot — a useSyncExternalStore
    // tearing violation. Microtask-coalesced `_notify` makes the always-
    // notify path effectively free (multiple synchronous calls collapse to
    // one fanout), so correctness wins.
    const reg = createRegistry();
    let count = 0;
    reg.subscribe(() => {
      count++;
    });
    const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    await flush();
    count = 0;
    // First contributeLabels for chunk A creates its chunkData entry → notify.
    reg.contributeLabels(a, new Set(), new Set());
    // Re-contributing for chunk A overwrites its ownLabels → notify (even
    // though the union didn't change, chunkData[a] did).
    reg.contributeLabels(a, new Set(['X']), new Set());
    // Same idempotent call: still mutates chunkData[a] (assigns the same
    // Sets to ownLabels) → notify.
    reg.contributeLabels(a, new Set(['X']), new Set());
    // Chunk B's first contributeLabels creates its chunkData entry → notify.
    reg.contributeLabels(b, new Set(['Y']), new Set());
    await flush();
    // All four mutations coalesce to ONE subscriber wake-up per microtask.
    expect(count).toBe(1);
    // And the union does still reflect every contribution.
    expect(reg.labelSet.footnoteLabels).toEqual(new Set(['X', 'Y']));
  });

  test('globalOccurrenceForRef maps chunk-local to global indices', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    reg.contributeChunkData(a, {
      refs: [
        { label: 'X', kind: 'footnote' },
        { label: 'Y', kind: 'footnote' },
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    reg.contributeChunkData(b, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    // chunk A's local X-occurrences: 1 → global 1, 2 → global 2.
    expect(reg.globalOccurrenceForRef(a, 'X', 1)).toBe(1);
    expect(reg.globalOccurrenceForRef(a, 'X', 2)).toBe(2);
    // chunk B's local X-occurrence: 1 → global 3.
    expect(reg.globalOccurrenceForRef(b, 'X', 1)).toBe(3);
    // chunk A's local Y-occurrence: 1 → global 1 (separate label).
    expect(reg.globalOccurrenceForRef(a, 'Y', 1)).toBe(1);
    // Out-of-range or wrong chunk → null.
    expect(reg.globalOccurrenceForRef(a, 'X', 5)).toBe(null);
    expect(reg.globalOccurrenceForRef(b, 'Y', 1)).toBe(null);
  });

  test('subscribe receives notification on version bump', async () => {
    const reg = createRegistry();
    let count = 0;
    const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));
    const unsub = reg.subscribe(() => {
      count++;
    });
    const a = reg.allocateSymbol('A'); // schedules wake-up
    await flush();
    expect(count).toBe(1);
    reg.contributeLabels(a, new Set(['X']), new Set()); // schedules wake-up
    await flush();
    expect(count).toBe(2);
    unsub();
    reg.contributeLabels(a, new Set(['Y']), new Set()); // unsubbed, no fanout
    await flush();
    expect(count).toBe(2);
  });

  test('multiple synchronous notifies coalesce into one subscriber wake-up', async () => {
    // The whole point of microtask-coalescing: N back-to-back mutations on
    // the same tick fan out to subscribers at most once. With N chunks each
    // calling allocateSymbol+contributeLabels+contributeChunkData during
    // mount, this collapses 3N wake-ups into 1.
    const reg = createRegistry();
    let count = 0;
    reg.subscribe(() => {
      count++;
    });
    const a = reg.allocateSymbol('A');
    reg.contributeLabels(a, new Set(['X']), new Set());
    reg.contributeChunkData(a, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    // Version is observable synchronously …
    expect(reg.version).toBeGreaterThan(0);
    // … but subscribers fire at most once per microtask.
    await new Promise<void>((r) => queueMicrotask(() => r()));
    expect(count).toBe(1);
  });
});
