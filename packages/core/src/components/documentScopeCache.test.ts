import { expect, test } from 'vitest';
import { createDocumentScopeCache } from './documentScopeCache';
import { createRegistry } from '@ai-react-markdown/engine';
import { createSmoothCoordinator } from './smoothStream/coordinator';

test('live scopes share identity per document, and an old release cannot evict a replacement', () => {
  const cache = createDocumentScopeCache((release) => ({ release }));
  const first = cache.get('a');
  expect(cache.get('a')).toBe(first);
  expect(cache.get('b')).not.toBe(first);
  first.release();
  const replacement = cache.get('a');
  expect(replacement).not.toBe(first);
  first.release();
  expect(cache.get('a')).toBe(replacement);
});

test('registry release/re-register revives the same scope until the final release', async () => {
  const cache = createDocumentScopeCache(createRegistry);
  const scope = cache.get('doc');
  const symbol = scope.registerChunk('a', new Set(), new Set());
  scope.releaseSymbol('a');
  expect(cache.get('doc').registerChunk('a', new Set(), new Set())).toBe(symbol);
  await Promise.resolve();
  expect(cache.get('doc')).toBe(scope);
  scope.releaseSymbol('a');
  await Promise.resolve();
  expect(cache.get('doc')).not.toBe(scope);
});

test('coordinator keeps sticky completion during revival, then evicts after final release', async () => {
  const cache = createDocumentScopeCache(createSmoothCoordinator);
  const scope = cache.get('doc');
  scope.register('a');
  scope.markDone('a');
  scope.release('a');
  cache.get('doc').register('a');
  await Promise.resolve();
  expect(cache.get('doc')).toBe(scope);
  expect(scope.done.has('a')).toBe(true);
  scope.release('a');
  await Promise.resolve();
  expect(cache.get('doc')).not.toBe(scope);
});
