import { computed, onMounted, onUnmounted, shallowRef, watch, watchPostEffect } from 'vue';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  createDefLabelScanner,
  sanitizeSchema,
  type RegistryInternal,
} from '@ai-react-markdown/engine';
import {
  createPipelineSession,
  createContributionSession,
  createBlockPlanner,
  derivePhantomTargets,
  deriveCoordinationPolicy,
  buildContributionChain,
  buildAggregateTree,
  type PhantomTargets,
  type CoordinationPolicy,
} from '@ai-react-markdown/runtime';

export interface ChunkInput {
  /** Already preprocessed, accumulated source. */
  content: string;
  documentId: string;
  registry: RegistryInternal | null;
  /** Already resolved against any document-level override. */
  preserveOrphanReferences: boolean;
  incrementalParse: boolean;
}

/** Experimental Vue lifecycle binding, not a published renderer.
 * Engine trees/registries stay outside deep reactive proxies. Vue tracks only
 * source inputs, allocation and the monotonic registry notification signal.
 */
export function useMarkdownChunk(input: () => ChunkInput) {
  const pipeline = createPipelineSession();
  const publisher = createContributionSession();
  const planner = createBlockPlanner();
  const scanner = createDefLabelScanner();
  const provenance = globalThis.crypto.randomUUID();
  const chunkId = globalThis.crypto.randomUUID();
  const allocation = shallowRef<{ registry: RegistryInternal; sym: symbol } | null>(null);
  const version = shallowRef(0);
  let targets: PhantomTargets | undefined;
  let policy: CoordinationPolicy | undefined;
  const ownLabels = computed(() => scanner.scan(input().content));
  const documentId = computed(() => input().documentId);
  const stablePlugins = computed(() => ({
    remarkPlugins: buildCoreRemarkPlugins([]),
    rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, `${documentId.value}-`, { provenance }),
    remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
  }));
  const prepared = computed(() => {
    void version.value;
    const current = input();
    const sym = allocation.value?.registry === current.registry ? (allocation.value?.sym ?? null) : null;
    targets = derivePhantomTargets(
      { content: current.content, ownLabels: ownLabels.value, labels: current.registry?.labelSet ?? null },
      targets
    );
    policy = deriveCoordinationPolicy(
      {
        coordinated: !!current.registry,
        registered: !!sym,
        preserveOrphanReferences: current.preserveOrphanReferences,
      },
      policy
    );
    const frameOptions = {
      ...stablePlugins.value,
      ...policy,
      content: current.content,
      targetPhantoms: targets,
      documentId: current.documentId,
      provenance,
      incrementalParse: current.incrementalParse,
      defListEnabled: false,
    };
    const trees = pipeline.parse(frameOptions);
    return {
      trees,
      targets,
      sym,
      registry: current.registry,
      clobberPrefix: `${current.documentId}-`,
      ownLabels: ownLabels.value,
      chain: buildContributionChain({ ...frameOptions, clobberPrefix: `${current.documentId}-` }),
      plan: planner(trees.mdast, trees.hast, current.content, { phantomFootnoteLabels: targets.missingFootnotes }),
    };
  });
  let stopRegistration: (() => void) | undefined;
  let stopPublishing: (() => void) | undefined;
  onMounted(() => {
    stopRegistration = watch(
      [() => input().registry, ownLabels],
      ([registry, labels], _old, cleanup) => {
        if (!registry) {
          allocation.value = null;
          return;
        }
        const unsubscribe = registry.subscribe(() => {
          version.value++;
        });
        const sym = registry.registerChunk(chunkId, labels.footnoteLabels, labels.linkLabels);
        allocation.value = { registry, sym };
        cleanup(() => {
          unsubscribe();
          registry.releaseSymbol(chunkId);
          allocation.value = null;
        });
      },
      { immediate: true, flush: 'post' }
    );
    stopPublishing = watchPostEffect(() => {
      const frame = prepared.value;
      publisher.commit({
        pipeline: frame.trees,
        ownLabels: frame.ownLabels,
        registry: frame.registry,
        targetPhantoms: frame.targets,
        sym: frame.sym,
        clobberPrefix: frame.clobberPrefix,
        chain: frame.chain,
      });
    });
  });
  onUnmounted(() => {
    stopPublishing?.();
    stopRegistration?.();
  });
  const aggregate = computed(() => {
    void version.value;
    const frame = prepared.value;
    if (!frame.registry || !frame.sym || frame.registry.chunkOrder.at(-1) !== frame.sym) return null;
    return buildAggregateTree(frame.registry, frame.clobberPrefix, input().preserveOrphanReferences);
  });
  return { prepared, aggregate };
}
