import { expect, test } from 'vitest';
import { buildContributionChain, deriveCoordinationPolicy, derivePhantomTargets } from './coordinationPreparation';
const empty = { footnoteLabels: new Set<string>(), linkLabels: new Set<string>() };
test('phantom decisions exclude own labels, preserve namespaces and reuse equal snapshots', () => {
  const input = {
    content: '[x] and [^n]',
    ownLabels: { ...empty, linkLabels: new Set(['X']) },
    labels: { footnoteLabels: new Set(['N', 'X']), linkLabels: new Set(['X', 'N', 'UNUSED']) },
  };
  const result = derivePhantomTargets(input);
  expect([...result.missingFootnotes]).toEqual(['N', 'X']);
  expect([...result.missingLinks]).toEqual(['N']);
  expect(derivePhantomTargets({ ...input, labels: { ...input.labels } }, result)).toBe(result);
  expect(derivePhantomTargets({ ...input, labels: null }, result)).toEqual({
    missingFootnotes: new Set(),
    missingLinks: new Set(),
  });
});
test('standalone uses only orphan handling; registration changes harvest without changing coordinated handlers', () => {
  expect(
    deriveCoordinationPolicy({ coordinated: false, registered: true, preserveOrphanReferences: false }).handlers
  ).toBeUndefined();
  const orphan = deriveCoordinationPolicy({ coordinated: false, registered: false, preserveOrphanReferences: true });
  expect(Object.keys(orphan.handlers!)).toEqual(['footnoteDefinition']);
  const before = deriveCoordinationPolicy({ coordinated: true, registered: false, preserveOrphanReferences: false });
  const after = deriveCoordinationPolicy(
    { coordinated: true, registered: true, preserveOrphanReferences: false },
    before
  );
  expect(before.preserveForBodyHarvest).toBe(false);
  expect(after.preserveForBodyHarvest).toBe(true);
  expect(after.handlers).toBe(before.handlers);
  expect(
    deriveCoordinationPolicy({ coordinated: true, registered: true, preserveOrphanReferences: false }, after)
  ).toBe(after);
});
test('contribution policy tracks every named body-affecting identity', () => {
  const input = {
    remarkPlugins: [],
    rehypePlugins: [],
    remarkRehypeOptions: {},
    handlers: undefined,
    preserveForBodyHarvest: false,
    clobberPrefix: 'doc-',
    documentId: 'doc',
    provenance: 'credential',
  };
  const before = buildContributionChain(input);
  for (const key of Object.keys(input)) {
    expect(buildContributionChain({ ...input, [key]: Symbol(key) })).not.toEqual(before);
  }
});
