import { computed, onMounted, onUnmounted, shallowRef, watch, watchPostEffect } from 'vue';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  createDefLabelScanner,
  sanitizeSchema,
  type AIMarkdownEnginePlugin,
  type SanitizeSchema,
  type RegistryController,
} from '@ai-markdown/engine';
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
} from '@ai-markdown/core';

export interface ChunkInput {
  /** Already preprocessed, accumulated source. */
  content: string;
  documentId: string;
  registry: RegistryController | null;
  /** Already resolved against any document-level override. */
  preserveOrphanReferences: boolean;
  incrementalParse: boolean;
  clobberPrefix: string;
  documentIndex?: number;
  enginePlugins: readonly AIMarkdownEnginePlugin[];
  sanitizeSchema: SanitizeSchema;
}

/** Vue lifecycle binding for one mounted chunk.
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
  const allocation = shallowRef<{ registry: RegistryController; sym: symbol } | null>(null);
  const version = shallowRef(0);
  let targets: PhantomTargets | undefined;
  let policy: CoordinationPolicy | undefined;
  const ownLabels = computed(() => scanner.scan(input().content));
  const selectedPlugins = computed(() => input().enginePlugins);
  const selectedSchema = computed(() => input().sanitizeSchema);
  const prefix = computed(() => input().clobberPrefix);
  const stablePlugins = computed(() => ({
    remarkPlugins: buildCoreRemarkPlugins(selectedPlugins.value),
    rehypePlugins: buildCoreRehypePlugins(selectedSchema.value ?? sanitizeSchema, prefix.value, { provenance }),
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
      defListEnabled: current.enginePlugins.some((plugin) => plugin.name === 'definitionList'),
    };
    const trees = pipeline.parse(frameOptions);
    return {
      trees,
      targets,
      sym,
      registry: current.registry,
      clobberPrefix: current.clobberPrefix,
      ownLabels: ownLabels.value,
      chain: buildContributionChain({ ...frameOptions, clobberPrefix: current.clobberPrefix }),
      plan: planner(trees.mdast, trees.hast, current.content, { phantomFootnoteLabels: targets.missingFootnotes }),
    };
  });
  let stopRegistration: (() => void) | undefined;
  let stopPublishing: (() => void) | undefined;
  onMounted(() => {
    stopRegistration = watch(
      [() => input().registry, ownLabels, () => input().documentIndex],
      ([registry, labels], _old, cleanup) => {
        if (!registry) {
          allocation.value = null;
          return;
        }
        const unsubscribe = registry.subscribe(() => {
          version.value++;
        });
        const sym = registry.registerChunk(chunkId, labels.footnoteLabels, labels.linkLabels, input().documentIndex);
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
