import type { Registry } from './documentRegistry';

export interface RegistryIndex {
  footnotes: Map<string, symbol>;
  links: Map<string, symbol>;
  numbers: Map<string, number>;
  counts: Map<string, number>;
  occurrences: Map<symbol, Map<string, { start: number; count: number }>>;
  labelOccurrences: Map<string, Map<symbol, { start: number; count: number }>>;
}

/** One ordered pass per observed registry version. Querying a reference no
 * longer rescans every earlier chunk. Inputs remain registry-owned; this
 * index is derived data and is discarded after any mutation or reordering. */
export function buildRegistryIndex(registry: Pick<Registry, 'chunkOrder' | 'chunkData'>): RegistryIndex {
  const index: RegistryIndex = {
    footnotes: new Map(),
    links: new Map(),
    numbers: new Map(),
    counts: new Map(),
    occurrences: new Map(),
    labelOccurrences: new Map(),
  };
  for (const sym of registry.chunkOrder) {
    const data = registry.chunkData.get(sym);
    if (!data) continue;
    for (const label of data.defs.keys()) if (!index.footnotes.has(label)) index.footnotes.set(label, sym);
    for (const label of data.linkDefs.keys()) if (!index.links.has(label)) index.links.set(label, sym);
    const local = new Map<string, { start: number; count: number }>();
    index.occurrences.set(sym, local);
    for (const ref of data.refs) {
      if (ref.kind !== 'footnote') continue;
      const label = ref.label;
      if (!index.numbers.has(label)) index.numbers.set(label, index.numbers.size + 1);
      const total = (index.counts.get(label) ?? 0) + 1;
      index.counts.set(label, total);
      const prior = local.get(label);
      if (prior) prior.count++;
      else {
        const range = { start: total, count: 1 };
        local.set(label, range);
        let byChunk = index.labelOccurrences.get(label);
        if (!byChunk) index.labelOccurrences.set(label, (byChunk = new Map()));
        byChunk.set(sym, range);
      }
    }
  }
  return index;
}
