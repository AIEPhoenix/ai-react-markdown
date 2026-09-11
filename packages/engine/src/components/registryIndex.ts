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
  // Nested footnote refs (inside a definition body) per chunk, in body
  // order, grouped by the label of the definition that contains them.
  const nestedByChunk = new Map<symbol, Map<string, string[]>>();
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
      if (ref.nestedIn !== undefined) {
        // Numbered below, once every flow reference has its number. Never
        // counted: the aggregate footer emits one backref per counted
        // occurrence, and a nested occurrence has no inline mark id.
        let byParent = nestedByChunk.get(sym);
        if (!byParent) nestedByChunk.set(sym, (byParent = new Map()));
        const siblings = byParent.get(ref.nestedIn);
        if (siblings) siblings.push(label);
        else byParent.set(ref.nestedIn, [label]);
        continue;
      }
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
  // Nested references are numbered the way mdast-util-to-hast's footer
  // numbers them: it converts the bodies of numbered definitions in number
  // order and appends each newly met reference to the end of the order, so
  // the order is a queue that grows while it is walked. Only the canonical
  // definition's body renders, so only its nested references count;
  // a duplicate definition in a later chunk contributes none.
  if (nestedByChunk.size > 0) {
    const queue = [...index.numbers.keys()];
    for (let i = 0; i < queue.length; i++) {
      const parent = queue[i];
      const owner = index.footnotes.get(parent);
      if (owner === undefined) continue;
      const nested = nestedByChunk.get(owner)?.get(parent);
      if (!nested) continue;
      for (const label of nested) {
        if (index.numbers.has(label)) continue;
        index.numbers.set(label, index.numbers.size + 1);
        queue.push(label);
      }
    }
  }
  return index;
}
