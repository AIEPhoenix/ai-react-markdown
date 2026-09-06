import { expect, test, vi } from 'vitest';
import { createRegistry, type ChunkData } from './documentRegistry';

const data = (refs: string[] = [], links: Array<[string, string]> = []): ChunkData => ({
  refs: refs.map((label) => ({ kind: 'footnote', label })),
  defs: new Map(),
  linkDefs: new Map(links.map(([identifier, url]) => [identifier, { identifier, url }])),
  ownFootnoteLabels: new Set(),
  ownLinkLabels: new Set(links.map(([label]) => label)),
});
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('an unrelated mutation wakes global observers but none of 1000 label subscribers', async () => {
  const r = createRegistry();
  const c = r.allocateSymbol('c');
  await drain();
  const callback = vi.fn();
  for (let i = 0; i < 1000; i++) r.subscribeLabel('link', `unchanged-${i}`, callback);
  const global = vi.fn();
  r.subscribe(global);
  r.contributeChunkData(c, data([], [['UNRELATED', '/new']]));
  await drain();
  expect(callback).not.toHaveBeenCalled();
  expect(global).toHaveBeenCalledTimes(1);
});

test('normalized link labels coalesce updates; footnote namespace stays independent', async () => {
  const r = createRegistry();
  const c = r.allocateSymbol('c');
  const link = vi.fn(),
    footnote = vi.fn();
  r.subscribeLabel('link', ' a ', link);
  r.subscribeLabel('footnote', 'A', footnote);
  r.contributeChunkData(c, data([], [['A', '/one']]));
  r.contributeChunkData(c, data([], [['A', '/two']]));
  await drain();
  expect(link).toHaveBeenCalledTimes(1);
  expect(footnote).not.toHaveBeenCalled();
  r.contributeChunkData(c, data([], [['A', '/temporary']]));
  r.contributeChunkData(c, data([], [['A', '/two']]));
  await drain();
  expect(link).toHaveBeenCalledTimes(1);
});

test('title changes and canonical owner removal notify even when the URL stays equal', async () => {
  const r = createRegistry();
  const a = r.allocateSymbol('a'),
    b = r.allocateSymbol('b');
  r.contributeChunkData(a, data([], [['A', '/a']]));
  r.contributeChunkData(b, data([], [['A', '/a']]));
  await drain();
  const callback = vi.fn();
  r.subscribeLabel('link', 'A', callback);
  const changed = data([], [['A', '/a']]);
  changed.linkDefs.get('A')!.title = 'new';
  r.contributeChunkData(a, changed);
  await drain();
  expect(callback).toHaveBeenCalledTimes(1);
  r.releaseSymbol('a');
  await drain();
  expect(callback).toHaveBeenCalledTimes(2);
  expect(r.canonicalLinkFor('A')).toBe(b);
});

test('adding another label before a footnote notifies its indirect renumbering', async () => {
  const r = createRegistry();
  const a = r.allocateSymbol('a', 0),
    b = r.allocateSymbol('b', 1);
  r.contributeChunkData(a, data());
  r.contributeChunkData(b, data(['B']));
  await drain();
  const callback = vi.fn();
  r.subscribeLabel('footnote', 'B', callback);
  r.contributeChunkData(a, data(['A']));
  await drain();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(r.globalNumber('B')).toBe(2);
});

test('reordering same-label references notifies occurrence changes without changing count or number', async () => {
  const r = createRegistry();
  const a = r.allocateSymbol('a', 0),
    b = r.allocateSymbol('b', 1);
  r.contributeChunkData(a, data(['A']));
  r.contributeChunkData(b, data(['A']));
  await drain();
  const callback = vi.fn();
  r.subscribeLabel('footnote', 'A', callback);
  r.allocateSymbol('a', 2);
  await drain();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(r.globalOccurrenceForRef(a, 'A', 1)).toBe(2);
  expect(r.globalOccurrenceForRef(b, 'A', 1)).toBe(1);
});

test('unsubscribe cleans groups; resubscription starts at the current snapshot', async () => {
  const r = createRegistry();
  const c = r.allocateSymbol('c');
  const callback = vi.fn();
  const off = r.subscribeLabel('link', 'A', callback);
  const off2 = r.subscribeLabel('link', 'A', callback);
  off();
  r.contributeChunkData(c, data([], [['A', '/a']]));
  await drain();
  expect(callback).toHaveBeenCalledTimes(1);
  off2();
  r.contributeChunkData(c, data([], [['A', '/b']]));
  r.subscribeLabel('link', 'A', callback);
  await drain();
  expect(callback).toHaveBeenCalledTimes(1);
  off2();
  r.contributeChunkData(c, data([], [['A', '/c']]));
  await drain();
  expect(callback).toHaveBeenCalledTimes(2);
});

test('reentrant mutations by global and label callbacks are observed in the next batch', async () => {
  const r = createRegistry();
  const c = r.allocateSymbol('c');
  await drain();
  const seen: string[] = [];
  r.subscribeLabel('link', 'A', () => {
    const url = r.resolveLinkDef('A')!.url;
    seen.push(url);
    if (url === '/two') r.contributeChunkData(c, data([], [['A', '/three']]));
  });
  const off = r.subscribe(() => {
    off();
    r.contributeChunkData(c, data([], [['A', '/two']]));
  });
  r.contributeChunkData(c, data([], [['A', '/one']]));
  await drain();
  await drain();
  expect(seen).toEqual(['/two', '/three']);
});

test('new subscriptions during fanout do not receive a stale scheduled notification', async () => {
  const r = createRegistry();
  const c = r.allocateSymbol('c');
  await drain();
  const added = vi.fn();
  const off = r.subscribe(() => {
    off();
    r.subscribeLabel('link', 'A', added);
  });
  r.contributeChunkData(c, data([], [['A', '/a']]));
  await drain();
  expect(added).not.toHaveBeenCalled();
  r.contributeChunkData(c, data([], [['A', '/b']]));
  await drain();
  expect(added).toHaveBeenCalledTimes(1);
});

test('mixed mutation histories notify exactly when indexed observable snapshots change', async () => {
  const same = (a: unknown, b: unknown): boolean =>
    Array.isArray(a) && Array.isArray(b)
      ? a.length === b.length && a.every((value, i) => same(value, b[i]))
      : Object.is(a, b);
  const r = createRegistry();
  const chunks = Array.from({ length: 6 }, (_, i) => r.allocateSymbol(`chunk-${i}`, i));
  const labels = ['A', 'B', 'C'];
  const seen = Array.from({ length: 6 }, () => vi.fn());
  labels.forEach((label, i) => {
    r.subscribeLabel('link', label.toLowerCase(), seen[i]);
    r.subscribeLabel('footnote', label.toLowerCase(), seen[i + 3]);
  });
  await drain();
  const snapshots = () => [
    ...labels.map((label) => [r.canonicalLinkFor(label), r.resolveLinkDef(label)?.url, r.resolveLinkDef(label)?.title]),
    ...labels.map((label) => [
      r.canonicalFootnoteFor(label),
      r.globalNumber(label),
      r.getRefsForLabel(label),
      chunks.map((chunk) => [1, 2, 3, 4].map((n) => r.globalOccurrenceForRef(chunk, label, n))),
    ]),
  ];
  let seed = 726391;
  const next = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  let changes = 0;
  for (let step = 0; step < 180; step++) {
    const before = snapshots();
    seen.forEach((callback) => callback.mockClear());
    const chunk = next(chunks.length);
    if (step % 11 === 0) {
      r.releaseSymbol(`chunk-${chunk}`);
      await drain();
      // Treat removal and replacement as separate notification batches.
      const removed = snapshots();
      seen.forEach((callback, i) => expect(callback.mock.calls.length).toBe(same(before[i], removed[i]) ? 0 : 1));
      seen.forEach((callback) => callback.mockClear());
      chunks[chunk] = r.allocateSymbol(`chunk-${chunk}`, next(12));
      await drain();
      continue;
    }
    if (step % 7 === 0) {
      r.allocateSymbol(`chunk-${chunk}`, next(12));
      r.releaseSymbol(`chunk-${chunk}`); // balance the move's temporary retain
    } else {
      const payload = data(
        Array.from({ length: next(5) }, () => labels[next(3)]),
        labels.filter(() => next(2) === 0).map((label) => [label, `/value-${next(4)}`])
      );
      for (const label of labels.filter(() => next(3) === 0)) {
        payload.defs.set(label, { identifier: label, contentSource: `body-${step}` });
        payload.ownFootnoteLabels.add(label);
      }
      r.contributeChunkData(chunks[chunk], payload);
    }
    await drain();
    const after = snapshots();
    seen.forEach((callback, i) => {
      const changed = !same(before[i], after[i]);
      if (changed) changes++;
      expect(callback.mock.calls.length, `step=${step}, observer=${i}`).toBe(changed ? 1 : 0);
    });
  }
  expect(changes).toBeGreaterThan(100);
});
