import { describe, expect, test } from 'vitest';
import { highlight, definitionList, smartypants, pangu, removeComments, defaultEnginePlugins } from './catalog';
import { isEnginePlugin, getEnginePluginInternals } from './defs';

describe('sealed engine plugin catalog', () => {
  test('the five plugins carry their public names', () => {
    expect(highlight.name).toBe('highlight');
    expect(definitionList.name).toBe('definitionList');
    expect(smartypants.name).toBe('smartypants');
    expect(pangu.name).toBe('pangu');
    expect(removeComments.name).toBe('removeComments');
  });

  test('every plugin object is frozen', () => {
    for (const plugin of [highlight, definitionList, smartypants, pangu, removeComments]) {
      expect(Object.isFrozen(plugin)).toBe(true);
    }
    expect(Object.isFrozen(defaultEnginePlugins)).toBe(true);
  });

  test('defaultEnginePlugins holds all five in canonical chain order', () => {
    expect(defaultEnginePlugins).toEqual([highlight, definitionList, removeComments, smartypants, pangu]);
    // Identity, not just deep equality — the "filter one out" idiom
    // (`defaultEnginePlugins.filter((p) => p !== pangu)`) relies on it.
    expect(defaultEnginePlugins[0]).toBe(highlight);
    expect(defaultEnginePlugins[4]).toBe(pangu);
  });

  test("internal metadata carries each plugin's chain stage", () => {
    expect(getEnginePluginInternals(highlight)).toMatchObject({ stage: 'extraSyntax' });
    expect(getEnginePluginInternals(definitionList)).toMatchObject({ stage: 'extraSyntax' });
    expect(getEnginePluginInternals(removeComments)).toMatchObject({ stage: 'displayOptimize' });
    expect(getEnginePluginInternals(smartypants)).toMatchObject({ stage: 'displayOptimize' });
    expect(getEnginePluginInternals(pangu)).toMatchObject({ stage: 'displayOptimize' });
  });

  test('getEnginePluginInternals rejects objects without sealed metadata', () => {
    const forged = { name: 'highlight', '~sealed': 'ai-react-markdown/engine-plugin' };
    expect(getEnginePluginInternals(forged as never)).toBeNull();
  });
});

test('public plugin guard validates catalog names without exposing stage metadata', () => {
  for (const plugin of [highlight, definitionList, removeComments, smartypants, pangu])
    expect(isEnginePlugin(plugin)).toBe(true);
  for (const invalid of [
    null,
    undefined,
    'highlight',
    {},
    { name: 'highlight' },
    { '~sealed': 'ai-react-markdown/engine-plugin', name: 'unknown', stage: 'extraSyntax' },
    { '~sealed': 'ai-react-markdown/engine-plugin', name: 'highlight', stage: 'displayOptimize' },
  ])
    expect(isEnginePlugin(invalid)).toBe(false);
});
