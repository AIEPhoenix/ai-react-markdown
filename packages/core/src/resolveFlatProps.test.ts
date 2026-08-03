import { afterEach, describe, expect, test, vi } from 'vitest';
import { resolveEngineValues, sanitizeEnginePlugins } from './resolveFlatProps';
import { highlight, definitionList, smartypants, pangu, removeComments, defaultEnginePlugins } from './plugins/catalog';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveEngineValues — two-level precedence', () => {
  test('nothing passed → shipped defaults, defaultEnginePlugins by identity', () => {
    const resolved = resolveEngineValues({});
    expect(resolved.blockMemo).toBe(true);
    expect(resolved.incrementalParse).toBe(true);
    expect(resolved.preserveOrphanReferences).toBe(true);
    expect(resolved.enginePlugins).toBe(defaultEnginePlugins);
  });

  test('null counts as absent (RSC/serialization punch-through guard)', () => {
    const resolved = resolveEngineValues({
      blockMemo: null,
      incrementalParse: null,
      preserveOrphanReferences: null,
      enginePlugins: null,
    });
    expect(resolved.blockMemo).toBe(true);
    expect(resolved.incrementalParse).toBe(true);
    expect(resolved.preserveOrphanReferences).toBe(true);
    expect(resolved.enginePlugins).toBe(defaultEnginePlugins);
  });

  test('explicit false wins for each switch', () => {
    const resolved = resolveEngineValues({
      blockMemo: false,
      incrementalParse: false,
      preserveOrphanReferences: false,
    });
    expect(resolved.blockMemo).toBe(false);
    expect(resolved.incrementalParse).toBe(false);
    expect(resolved.preserveOrphanReferences).toBe(false);
  });

  test('explicit enginePlugins replaces the default set wholesale (empty array = everything off)', () => {
    expect(resolveEngineValues({ enginePlugins: [] }).enginePlugins).toEqual([]);
    expect(resolveEngineValues({ enginePlugins: [highlight] }).enginePlugins).toEqual([highlight]);
  });
});

describe('sanitizeEnginePlugins', () => {
  test('returns the input array identity when nothing needs removing', () => {
    const input = [pangu, highlight];
    expect(sanitizeEnginePlugins(input)).toBe(input);
  });

  test('deduplicates by name with a dev warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = sanitizeEnginePlugins([pangu, pangu, highlight]);
    expect(out).toEqual([pangu, highlight]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('duplicate');
  });

  test('drops objects without sealed metadata with a dev warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forged = { name: 'smartypants', '~sealed': 'ai-react-markdown/engine-plugin' };
    const out = sanitizeEnginePlugins([forged as never, definitionList, removeComments, smartypants]);
    expect(out).toEqual([definitionList, removeComments, smartypants]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('not a sealed engine plugin');
  });

  test('drops stage-only structural mimics — the runtime gate requires BOTH seal keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mimic = { name: 'pangu', stage: 'displayOptimize' };
    const out = sanitizeEnginePlugins([mimic as never, highlight]);
    expect(out).toEqual([highlight]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('not a sealed engine plugin');
  });
});
