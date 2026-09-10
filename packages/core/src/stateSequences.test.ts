import { expect, test } from 'vitest';
import fc from 'fast-check';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  createRegistry,
  collectDefLabels,
  parseStage,
  transformStage,
  sanitizeSchema,
  removeComments,
  smartypants,
  type RegistryController,
} from '@ai-markdown/engine';
import {
  createPipelineSession,
  createBlockPlanner,
  buildBlocks,
  createContributionSession,
  buildContributionChain,
  buildAggregateTree,
  createSmoothCoordinator,
} from './index';

// Fixed seeds are part of the gate. fast-check reports the seed, shrink path
// and minimal operation sequence on failure; replay with CORE_SEQUENCE_SEED/PATH.
const seeds = process.env.CORE_SEQUENCE_SEED
  ? [Number(process.env.CORE_SEQUENCE_SEED)]
  : [20260909, 20260910, 20260911];
const runs = Number(process.env.CORE_SEQUENCE_RUNS ?? 24);
if (!Number.isSafeInteger(runs) || runs < 1 || seeds.some((seed) => !Number.isSafeInteger(seed))) {
  throw new Error('Invalid core sequence seed/run count');
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const options = (documentId: string, revision: number) => ({
  clobberPrefix: `${documentId}-${revision}-`,
  remarkPlugins: buildCoreRemarkPlugins(revision % 2 ? [removeComments, smartypants] : []),
  rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, `${documentId}-${revision}-`),
  remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
  documentId,
  provenance: 'core-state-sequence',
  incrementalParse: true,
  preserveForBodyHarvest: false,
  defListEnabled: false,
  targetPhantoms: { missingFootnotes: new Set<string>(), missingLinks: new Set<string>() },
});
const fragments = [
  'Text "quoted" <!-- comment -->.\n\n',
  '**bold**',
  '[link][u]',
  '\n\n[u]: /target\n',
  '\n\n[^n]: body\n',
  'Note[^n]',
  '\n\n```js\nx\n```\n',
  '<details>\n\ninside\n',
  '\n</details>\n',
];
const operation = fc.record({
  kind: fc.integer({ min: 0, max: 5 }),
  chunk: fc.integer({ min: 0, max: 2 }),
  value: fc.integer({ min: 0, max: fragments.length - 1 }),
});
const sequences = fc.array(operation, { minLength: 24, maxLength: 48 });

for (const seed of seeds) {
  const parameters = {
    seed,
    numRuns: runs,
    ...(process.env.CORE_SEQUENCE_PATH ? { path: process.env.CORE_SEQUENCE_PATH } : {}),
  };
  test(`pipeline and planner state sequences match fresh engine/full plans (seed ${seed})`, () => {
    fc.assert(
      fc.property(sequences, (ops) => {
        const session = createPipelineSession();
        const planner = createBlockPlanner();
        let config = options('first', 0),
          content = '',
          revision = 0;
        // Mandatory transitions prevent a random sample from skipping an axis.
        for (const op of [
          ...Array.from({ length: 6 }, (_, kind) => ({ kind, chunk: 0, value: 0 })),
          { kind: 4, chunk: 0, value: 0 },
          { kind: 5, chunk: 0, value: 1 },
          ...ops,
        ]) {
          if (op.kind === 0) content += fragments[op.value];
          if (op.kind === 1) content = fragments[op.value];
          if (op.kind === 2) config = options('first', ++revision);
          if (op.kind === 3) config = options(`doc-${op.chunk}`, ++revision);
          if (op.kind === 4) session.reset();
          const actual = session.parse({ ...config, content, incrementalParse: op.kind !== 5 });
          const parsed = parseStage({ ...config, children: content });
          expect(actual).toEqual({ mdast: parsed.mdast, hast: transformStage(parsed) });
          const phantoms = op.kind === 2 ? new Set(['N']) : undefined;
          expect(planner(actual.mdast, actual.hast, content, { phantomFootnoteLabels: phantoms })).toEqual(
            buildBlocks(actual.mdast, actual.hast, content, { phantomFootnoteLabels: phantoms })
          );
        }
      }),
      parameters
    );
  });

  // Each seed rebuilds two registries after every operation in 24 sequences.
  // The first cold run exceeded Vitest's 5s default on CI (5.145s); this is
  // a correctness oracle, not a latency benchmark. Keep every case and allow
  // bounded time for the full workload and failure shrinking on shared hosts.
  test(
    `contribution/aggregate state sequences equal clean document reconstruction (seed ${seed})`,
    { timeout: 30_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(sequences, async (ops) => {
          const registries = [createRegistry(), createRegistry()];
          const chunks = Array.from({ length: 3 }, (_, index) => ({
            index,
            doc: 0,
            active: true,
            source: `note[^n]\n\n[^n]: body ${index}\n\n[u]: /${index}`,
            session: createPipelineSession(),
            publisher: createContributionSession(),
            config: options('doc-0', 0),
            sym: null as symbol | null,
          }));
          const snapshot = (registry: RegistryController, prefix: string) => ({
            labels: {
              footnotes: [...registry.labelSet.footnoteLabels].sort(),
              links: [...registry.labelSet.linkLabels].sort(),
            },
            number: registry.globalNumber('N'),
            link: registry.resolveLinkDef('U'),
            aggregate: buildAggregateTree(registry, prefix, true),
          });
          try {
            for (const op of [
              ...Array.from({ length: 6 }, (_, kind) => ({ kind, chunk: 0, value: 0 })),
              { kind: 4, chunk: 0, value: 0 },
              { kind: 5, chunk: 0, value: 1 },
              ...ops,
            ]) {
              const chunk = chunks[op.chunk];
              if (op.kind === 0) chunk.source += '\n\nappend[^n]';
              if (op.kind === 1) chunk.source = `note[^n]\n\n[^n]: changed ${op.value}\n\n[u]: /${op.value}`;
              if (op.kind === 2) chunk.source = 'definitions removed';
              if (op.kind === 3 || op.kind === 4) {
                if (chunk.sym) registries[chunk.doc].releaseSymbol(String(chunk.index));
                chunk.sym = null;
                await settle();
                if (op.kind === 3) chunk.doc = 1 - chunk.doc;
                else chunk.active = !chunk.active;
                chunk.config = options(`doc-${chunk.doc}`, 0);
              }
              if (op.kind === 5) chunk.config = options(`doc-${chunk.doc}`, op.value);
              const fresh = [createRegistry(), createRegistry()];
              try {
                for (const current of chunks.filter((item) => item.active)) {
                  const ownLabels = collectDefLabels(current.source);
                  const registry = registries[current.doc];
                  if (!current.sym)
                    current.sym = registry.registerChunk(
                      String(current.index),
                      ownLabels.footnoteLabels,
                      ownLabels.linkLabels,
                      current.index
                    );
                  const frame = { ...current.config, content: current.source };
                  const commit = {
                    ownLabels,
                    targetPhantoms: frame.targetPhantoms,
                    clobberPrefix: frame.clobberPrefix,
                    chain: buildContributionChain(frame),
                  };
                  // The exact prefix must match the active pipeline even after a
                  // policy replacement; full reconstruction uses the same policy.
                  const pipeline = current.session.parse(frame);
                  const other = fresh[current.doc];
                  const otherSym = other.registerChunk(
                    String(current.index),
                    ownLabels.footnoteLabels,
                    ownLabels.linkLabels,
                    current.index
                  );
                  const full = createPipelineSession().parse({ ...frame, incrementalParse: false });
                  current.publisher.commit({ ...commit, pipeline, registry, sym: current.sym });
                  const version = registry.version;
                  current.publisher.commit({ ...commit, pipeline, registry, sym: current.sym });
                  expect(registry.version).toBe(version);
                  createContributionSession().commit({ ...commit, pipeline: full, registry: other, sym: otherSym });
                }
                for (let doc = 0; doc < 2; doc++)
                  expect(snapshot(registries[doc], 'view-')).toEqual(snapshot(fresh[doc], 'view-'));
              } finally {
                for (const current of chunks.filter((item) => item.active))
                  fresh[current.doc].releaseSymbol(String(current.index));
                await settle();
                for (const registry of fresh) expect(registry.chunkData.size).toBe(0);
              }
            }
          } finally {
            for (const chunk of chunks) if (chunk.sym) registries[chunk.doc].releaseSymbol(String(chunk.index));
            await settle();
            for (const registry of registries) {
              expect(registry.chunkOrder).toHaveLength(0);
              expect(registry.chunkData.size).toBe(0);
              expect(registry.labelSet.footnoteLabels.size).toBe(0);
              expect(registry.labelSet.linkLabels.size).toBe(0);
            }
          }
        }),
        parameters
      );
    }
  );

  test(`smooth coordinator matches an independent lifecycle model (seed ${seed})`, async () => {
    await fc.assert(
      fc.asyncProperty(sequences, async (ops) => {
        const c = createSmoothCoordinator();
        const order: string[] = [],
          counts = new Map<string, number>(),
          done = new Set<string>();
        let wakes = 0;
        const unsubscribe = c.subscribe(() => wakes++);
        for (const op of [
          { kind: 0, chunk: 0, value: 0 },
          { kind: 3, chunk: 1, value: 0 },
          { kind: 2, chunk: 0, value: 0 },
          { kind: 4, chunk: 1, value: 0 },
          { kind: 5, chunk: 1, value: 0 },
          { kind: 1, chunk: 1, value: 0 },
          ...ops,
        ]) {
          const id = String(op.chunk),
            count = counts.get(id) ?? 0;
          if (op.kind === 0 || op.kind === 3) {
            c.register(id);
            counts.set(id, count + 1);
            if (!count) order.push(id);
          } else if (op.kind === 1 && count) {
            c.release(id);
            if (count > 1) counts.set(id, count - 1);
            else {
              counts.delete(id);
              order.splice(order.indexOf(id), 1);
              done.delete(id);
            }
          } else if (op.kind === 2 && count) {
            c.markDone(id);
            done.add(id);
          } else if (op.kind === 4 && count) {
            c.release(id);
            c.register(id);
          } else if (op.kind === 5 && count) {
            const version = c.version;
            c.stampProgress(id, 100);
            expect(c.version).toBe(version);
          }
          await settle();
          expect(c.order).toEqual(order);
          expect([...c.done].sort()).toEqual([...done].sort());
          for (const target of ['0', '1', '2', 'unregistered']) {
            const at = order.indexOf(target);
            const predecessors = at < 0 ? order : order.slice(0, at);
            const blocker = predecessors.find((item) => !done.has(item)) ?? null;
            expect(c.isReleased(target)).toBe(blocker === null);
            expect(c.earliestBlockerOf(target)).toBe(blocker);
          }
        }
        unsubscribe();
        const before = wakes;
        for (const [id, count] of counts) for (let i = 0; i < count; i++) c.release(id);
        await settle();
        expect(c.order).toHaveLength(0);
        expect(c.done.size).toBe(0);
        expect(c.lastProgressAt.size).toBe(0);
        expect(wakes).toBe(before);
      }),
      parameters
    );
  });
}
