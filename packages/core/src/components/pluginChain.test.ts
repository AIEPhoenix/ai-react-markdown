/**
 * Pins the order-independence contract of the produced chain: the canonical
 * per-stage tables — not the caller's array order — fix each plugin's splice
 * position (see `buildCoreRemarkPlugins`). The property currently holds by
 * construction; this test keeps it holding through future refactors.
 */
import { describe, expect, test } from 'vitest';
import { buildCoreRemarkPlugins } from './pluginChain';
import { defaultEnginePlugins, highlight, pangu, smartypants } from '../plugins/catalog';

/** Unwrap `[plugin, options]` tuples to the plugin function for identity comparison. */
function chainShape(chain: ReturnType<typeof buildCoreRemarkPlugins>) {
  return chain.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
}

describe('buildCoreRemarkPlugins — user array order independence', () => {
  test('reversed full selection produces the identical chain', () => {
    const forward = buildCoreRemarkPlugins(defaultEnginePlugins);
    const reversed = buildCoreRemarkPlugins([...defaultEnginePlugins].reverse());
    expect(chainShape(reversed)).toEqual(chainShape(forward));
  });

  test('partial selections agree regardless of order', () => {
    const a = buildCoreRemarkPlugins([highlight, pangu, smartypants]);
    const b = buildCoreRemarkPlugins([smartypants, highlight, pangu]);
    const c = buildCoreRemarkPlugins([pangu, smartypants, highlight]);
    expect(chainShape(b)).toEqual(chainShape(a));
    expect(chainShape(c)).toEqual(chainShape(a));
  });
});
