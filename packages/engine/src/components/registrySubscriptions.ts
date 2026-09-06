import type { Registry } from './documentRegistry';
import type { RegistryIndex } from './registryIndex';
import { normalizeId } from './normalizeId';

type Snapshot = {
  owner?: symbol;
  url?: string;
  title?: string;
  number?: number;
  count?: number;
  occurrences?: Map<symbol, { start: number; count: number }>;
};
type Group = { snapshot: Snapshot; listeners: Set<() => void> };

function equal(a: Snapshot, b: Snapshot): boolean {
  if (a.owner !== b.owner || a.url !== b.url || a.title !== b.title || a.number !== b.number || a.count !== b.count)
    return false;
  if (a.occurrences?.size !== b.occurrences?.size) return false;
  if (a.occurrences) {
    for (const [chunk, range] of a.occurrences) {
      const next = b.occurrences?.get(chunk);
      if (!next || next.start !== range.start || next.count !== range.count) return false;
    }
  }
  return true;
}

/** One comparison per subscribed label, independent of its placeholder
 * count. A new ordered index catches indirect renumbering and canonical
 * owner changes; checking only labels touched by a mutation would miss them. */
export function createRegistrySubscriptions(read: () => { registry: Registry; index: RegistryIndex }) {
  const groups = { link: new Map<string, Group>(), footnote: new Map<string, Group>() };
  const snapshot = (
    kind: keyof typeof groups,
    label: string,
    { registry, index }: ReturnType<typeof read>
  ): Snapshot => {
    if (kind === 'link') {
      const owner = index.links.get(label);
      const def = owner ? registry.chunkData.get(owner)?.linkDefs.get(label) : undefined;
      return { owner, url: def?.url, title: def?.title };
    }
    return {
      owner: index.footnotes.get(label),
      number: index.numbers.get(label),
      count: index.counts.get(label),
      occurrences: index.labelOccurrences.get(label),
    };
  };
  return {
    subscribe(kind: keyof typeof groups, rawLabel: string, cb: () => void) {
      const label = normalizeId(rawLabel);
      const map = groups[kind];
      let group = map.get(label);
      if (!group) {
        group = { snapshot: snapshot(kind, label, read()), listeners: new Set() };
        map.set(label, group);
      }
      // Each subscription owns its registration, including repeated callbacks.
      const listener = () => cb();
      group.listeners.add(listener);
      return () => {
        group.listeners.delete(listener);
        if (group.listeners.size === 0 && map.get(label) === group) map.delete(label);
      };
    },
    collect(): Array<() => void> {
      if (groups.link.size === 0 && groups.footnote.size === 0) return [];
      const state = read();
      const callbacks: Array<() => void> = [];
      for (const kind of ['link', 'footnote'] as const) {
        for (const [label, group] of groups[kind]) {
          const next = snapshot(kind, label, state);
          if (!equal(group.snapshot, next)) callbacks.push(...group.listeners);
          group.snapshot = next;
        }
      }
      // Baselines are advanced before ANY callback runs. A reentrant
      // mutation is therefore observed by the next coalesced notification.
      return callbacks;
    },
  };
}
