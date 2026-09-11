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

test('a footnote referenced only from another footnote body is listed after the flow refs, with one backref', async () => {
  // Chunk one: flow ref to A; A's body references C (nested). Chunk two: flow
  // ref to B whose body references D and C. Standalone numbers these
  // a=1 b=2 c=3 d=4 (footer order); the aggregate must list the same
  // entries in the same order even though chunk one's nested ref to C
  // precedes chunk two's flow ref to B in document order.
  const registry = createRegistry();
  const one = registry.registerChunk('one', new Set(['A', 'C']), new Set());
  const two = registry.registerChunk('two', new Set(['B', 'D']), new Set());
  const def = (label: string) =>
    [
      label,
      {
        identifier: label,
        sourceIdentifier: label.toLowerCase(),
        contentSource: `body ${label}`,
        bodyHast: [
          { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: `body ${label}` }] },
        ] as ElementContent[],
      },
    ] as const;
  registry.contributeChunkData(one, {
    refs: [
      { label: 'A', kind: 'footnote' },
      { label: 'C', kind: 'footnote', nestedIn: 'A' },
    ],
    defs: new Map([def('A'), def('C')]),
    linkDefs: new Map(),
    ownFootnoteLabels: new Set(['A', 'C']),
    ownLinkLabels: new Set(),
  });
  registry.contributeChunkData(two, {
    refs: [
      { label: 'B', kind: 'footnote' },
      { label: 'D', kind: 'footnote', nestedIn: 'B' },
      { label: 'C', kind: 'footnote', nestedIn: 'B' },
    ],
    defs: new Map([def('B'), def('D')]),
    linkDefs: new Map(),
    ownFootnoteLabels: new Set(['B', 'D']),
    ownLinkLabels: new Set(),
  });
  try {
    const tree = buildAggregateTree(registry, 'doc-')!;
    const items: [string, string | undefined, string[]][] = [];
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'li') return;
      const backrefs: string[] = [];
      visit(node, 'element', (inner) => {
        if (inner.properties.dataFootnoteBackref !== undefined) backrefs.push(String(inner.properties.href));
      });
      items.push([String(node.properties.id), node.properties.value as string | undefined, backrefs]);
    });
    expect(items).toEqual([
      ['doc-fn-a', '1', ['#doc-fnref-a']],
      ['doc-fn-b', '2', ['#doc-fnref-b']],
      // Nested-only labels get exactly one backref (the bare first-occurrence
      // href, which the mark inside the harvested body carries); never a
      // `-2` that no inline mark rendered.
      ['doc-fn-c', '3', ['#doc-fnref-c']],
      ['doc-fn-d', '4', ['#doc-fnref-d']],
    ]);
  } finally {
    registry.releaseSymbol('one');
    registry.releaseSymbol('two');
    await settle();
  }
});
