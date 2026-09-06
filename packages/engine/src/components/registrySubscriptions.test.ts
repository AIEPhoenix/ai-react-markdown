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
