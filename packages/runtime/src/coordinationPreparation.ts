/** Shared decisions only: no registration, subscriptions or publication.
 * Previous outputs are optional identity hints owned by one host consumer.
 * Input label sets and returned objects must be treated as immutable snapshots.
 */
import { buildCrossChunkHandlers, normalizeForMatch } from '@ai-react-markdown/engine';
import type { PipelineFrameOptions } from './pipelineSession';

export interface DefinitionLabels {
  footnoteLabels: ReadonlySet<string>;
  linkLabels: ReadonlySet<string>;
}
export type PhantomTargets = PipelineFrameOptions['targetPhantoms'];

export function derivePhantomTargets(
  { content, ownLabels, labels }: { content: string; ownLabels: DefinitionLabels; labels: DefinitionLabels | null },
  previous?: PhantomTargets
): PhantomTargets {
  const missingFootnotes = new Set<string>();
  const missingLinks = new Set<string>();
  if (labels) {
    const footnotes = [...labels.footnoteLabels].filter((label) => !ownLabels.footnoteLabels.has(label));
    const links = [...labels.linkLabels].filter((label) => !ownLabels.linkLabels.has(label));
    // Avoid two full-content normalization passes when there are no candidates.
    if (footnotes.length || links.length) {
      const normalized = normalizeForMatch(content);
      for (const label of footnotes) if (normalized.includes(label)) missingFootnotes.add(label);
      for (const label of links) if (normalized.includes(label)) missingLinks.add(label);
    }
  }
  if (
    previous &&
    missingFootnotes.size === previous.missingFootnotes.size &&
    missingLinks.size === previous.missingLinks.size &&
    [...missingFootnotes].every((label) => previous.missingFootnotes.has(label)) &&
    [...missingLinks].every((label) => previous.missingLinks.has(label))
  )
    return previous;
  return { missingFootnotes, missingLinks };
}

export interface CoordinationPolicy {
  mode: 'coordinated' | 'orphan' | 'standalone';
  handlers: PipelineFrameOptions['handlers'];
  preserveForBodyHarvest: boolean;
}

export function deriveCoordinationPolicy(
  {
    coordinated,
    registered,
    preserveOrphanReferences,
  }: {
    coordinated: boolean;
    registered: boolean;
    /** The host has already resolved any wrapper-level override. */
    preserveOrphanReferences: boolean;
  },
  previous?: CoordinationPolicy
): CoordinationPolicy {
  const mode = coordinated ? 'coordinated' : preserveOrphanReferences ? 'orphan' : 'standalone';
  const preserveForBodyHarvest = preserveOrphanReferences || (coordinated && registered);
  if (previous?.mode === mode && previous.preserveForBodyHarvest === preserveForBodyHarvest) return previous;
  // Registration can change body harvesting without changing handler identity.
  const handlers =
    previous?.mode === mode
      ? previous.handlers
      : mode === 'coordinated'
        ? buildCrossChunkHandlers()
        : mode === 'orphan'
          ? { footnoteDefinition: buildCrossChunkHandlers().footnoteDefinition }
          : undefined;
  return { mode, handlers, preserveForBodyHarvest };
}

export type ContributionPolicyInputs = Pick<
  PipelineFrameOptions,
  | 'remarkPlugins'
  | 'rehypePlugins'
  | 'remarkRehypeOptions'
  | 'handlers'
  | 'preserveForBodyHarvest'
  | 'documentId'
  | 'provenance'
> & { clobberPrefix: string };

/** Source/phantom/registry/symbol changes are compared by the publisher itself.
 * This tuple covers the remaining inputs that can alter harvested bodies.
 */
export function buildContributionChain(inputs: ContributionPolicyInputs): readonly unknown[] {
  return [
    inputs.remarkPlugins,
    inputs.rehypePlugins,
    inputs.remarkRehypeOptions,
    inputs.handlers,
    inputs.preserveForBodyHarvest,
    inputs.clobberPrefix,
    inputs.documentId,
    inputs.provenance,
  ];
}
