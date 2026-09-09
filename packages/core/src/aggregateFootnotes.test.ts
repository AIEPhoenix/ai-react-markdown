import { expect, test } from 'vitest';
import { createRegistry, type RegistryController } from '@ai-markdown/engine';
import type { ElementContent } from 'hast';
import { visit } from 'unist-util-visit';
import { buildAggregateTree } from './aggregateFootnotes';

function contribute(registry: RegistryController, id: string, labels: string[], refs: string[]) {
  const sym = registry.registerChunk(id, new Set(labels), new Set());
  registry.contributeChunkData(sym, {
    refs: refs.map((label) => ({ label, kind: 'footnote' as const })),
    defs: new Map(
      labels.map((label) => [
        label,
        {
          identifier: label,
          sourceIdentifier: label.toLowerCase(),
          contentSource: `body ${label}`,
          bodyHast: [
            { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: `body ${label}` }] },
          ] as ElementContent[],
        },
      ])
    ),
    linkDefs: new Map(),
    ownFootnoteLabels: new Set(labels),
    ownLinkLabels: new Set(),
  });
  return sym;
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('aggregate orders references, emits every backref and appends only requested orphans', async () => {
  const registry = createRegistry();
  contribute(registry, 'first', ['A', 'B', 'ORPHAN'], ['B', 'A']);
  contribute(registry, 'second', [], ['B']);
  try {
    const ids: string[] = [],
      backrefs: string[] = [];
    const tree = buildAggregateTree(registry, 'doc-', true)!;
    visit(tree, 'element', (node) => {
      if (node.tagName === 'li') ids.push(String(node.properties.id));
      if (node.properties.dataFootnoteBackref !== undefined) backrefs.push(String(node.properties.href));
    });
    expect(ids).toEqual(['doc-fn-b', 'doc-fn-a', 'doc-fn-orphan']);
    expect(backrefs).toEqual(['#doc-fnref-b', '#doc-fnref-b-2', '#doc-fnref-a']);
    expect(JSON.stringify(buildAggregateTree(registry, 'doc-', false))).not.toContain('body ORPHAN');
    registry.releaseSymbol('second');
    await settle();
    expect(JSON.stringify(buildAggregateTree(registry, 'doc-'))).not.toContain('fnref-b-2');
  } finally {
    registry.releaseSymbol('first');
    registry.releaseSymbol('second');
    await settle();
  }
  expect(buildAggregateTree(registry, 'doc-')).toBeNull();
});

test('aggregate output owns body nodes and properties across callers and prefixes', async () => {
  const registry = createRegistry();
  const sym = contribute(registry, 'chunk', ['A'], ['A']);
  try {
    const body = registry.chunkData.get(sym)!.defs.get('A')!.bodyHast!;
    const before = JSON.stringify(body);
    const tree = buildAggregateTree(registry, 'first-')!;
    visit(tree, 'element', (node) => {
      node.properties.title = 'consumer mutation';
    });
    expect(JSON.stringify(body)).toBe(before);
    const other = JSON.stringify(buildAggregateTree(registry, 'second-'));
    expect(other).not.toContain('consumer mutation');
    expect(other).not.toContain('first-');
    expect(other).toContain('second-fnref-a');
  } finally {
    registry.releaseSymbol('chunk');
    await settle();
  }
});
