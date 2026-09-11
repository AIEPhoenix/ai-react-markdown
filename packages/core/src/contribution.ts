import type { Root as MdastRoot } from 'mdast';
import type { Root as HastRoot, ElementContent as HastElementContent } from 'hast';
import { extractContributions, extractDefBodiesFromHast, footnoteSafeId, type ChunkData } from '@ai-markdown/engine';

/** Minimal write capability; registration and cleanup remain with the adapter. */
export interface ContributionRegistry {
  contributeChunkData(symbol: symbol, data: ChunkData): void;
}

export interface ContributionOptions {
  pipeline: { mdast: MdastRoot; hast: HastRoot };
  ownLabels: { footnoteLabels: Set<string>; linkLabels: Set<string> };
  registry: ContributionRegistry | null;
  targetPhantoms: { missingFootnotes: Set<string>; missingLinks: Set<string> };
  sym: symbol | null;
  clobberPrefix: string;
  /** Stable identity tuple of parse inputs. Source equality alone cannot
   * validate definition bodies after a plugin or schema change. */
  chain: readonly unknown[];
}

export interface ContributionSession {
  commit(options: ContributionOptions): void;
}

/** Create one contribution publisher per mounted chunk.
 * Call commit only in the host's commit/effect phase, after registration.
 * Constructing a session does not register or publish anything. A discarded
 * render must never call commit. The host owns registration and cleanup.
 */
export function createContributionSession(): ContributionSession {
  let lastContribution: {
    registry: ContributionRegistry;
    symbol: symbol;
    fp: string;
    chain: readonly unknown[];
  } | null = null;
  return {
    commit({ pipeline, ownLabels, registry, targetPhantoms, sym, clobberPrefix, chain }: ContributionOptions): void {
      if (!registry || !sym) return;
      const refs: ChunkData['refs'] = [];
      // Collect def metadata first so the fingerprint compares only cheap
      // fields. bodyHast is sourced from the post-pipeline hast (not from a
      // bare mdast→hast walk) so def bodies inside the cross-chunk aggregate
      // render with full plugin output (math, raw HTML, defLists, …).
      const defMeta = new Map<string, { identifier: string; sourceIdentifier: string; contentSource: string }>();
      const linkDefs = new Map<string, { identifier: string; url: string; title?: string }>();
      // Link-definition URLs enter the registry RAW: the render-time
      // `resolveCrossChunkReference` gate in the placeholders is the single point
      // of enforcement (schema + hash rebasing + urlTransform, per attribute
      // key). A contribute-time pre-pass used to collapse a blocked URL to ''
      // — indistinguishable from a legal empty destination — and applied a
      // rewriting urlTransform twice (v2.4.2 review P1-4).
      for (const node of extractContributions(pipeline.mdast, {
        phantomFootnoteLabels: targetPhantoms.missingFootnotes,
      })) {
        if (node.kind === 'ref') {
          // `nestedIn` marks a footnote ref inside a definition body: it is
          // numbered after the flow refs but never counted as an occurrence.
          refs.push({
            label: node.label,
            kind: node.refKind,
            referenceType: node.referenceType,
            ...(node.nestedIn !== undefined ? { nestedIn: node.nestedIn } : {}),
          });
        } else if (node.kind === 'fnDef') {
          defMeta.set(node.label, {
            identifier: node.label,
            sourceIdentifier: node.sourceIdentifier,
            contentSource: node.content,
          });
        } else if (node.kind === 'linkDef') {
          linkDefs.set(node.label, { identifier: node.label, url: node.url, title: node.title });
        }
      }
      const fp = JSON.stringify({
        r: refs,
        d: Array.from(defMeta.entries()).map(([k, v]) => [k, v.sourceIdentifier, v.contentSource]),
        l: Array.from(linkDefs.entries()).map(([k, v]) => [k, v.url, v.title ?? '']),
        ofn: Array.from(ownLabels.footnoteLabels).sort(),
        ol: Array.from(ownLabels.linkLabels).sort(),
        // Include targetPhantoms in the fingerprint: a phantom→resolved
        // transition (another chunk publishes a def for a label this chunk
        // references inside one of its OWN def bodies) changes the rendered
        // hast — the `<cross-chunk-link>` / `<cross-chunk-image>` placeholder
        // disappears and a real `<a>` / `<img>` takes its place — without
        // touching this chunk's refs / defMeta / linkDefs / ownLabels. Without
        // including the phantom snapshot in the fingerprint, the fp check
        // would short-circuit and the registry would keep stale bodyHast
        // forever, leaving the aggregate footer rendering the placeholder
        // long after the label was resolved.
        tpfn: Array.from(targetPhantoms.missingFootnotes).sort(),
        tpl: Array.from(targetPhantoms.missingLinks).sort(),
      });
      const last = lastContribution;
      if (
        last?.registry === registry &&
        last.symbol === sym &&
        last.fp === fp &&
        last.chain.length === chain.length &&
        last.chain.every((dep, i) => dep === chain[i])
      ) {
        return;
      }
      // Fingerprint changed → harvest bodyHast from the post-pipeline hast
      // and publish. Missing entries are defensive: after allocation,
      // preserveForBodyHarvest keeps real local defs in the synthetic footer
      // even when visible orphan rendering is disabled.
      // Harvested bodies are keyed by the encoded `<li id>` fragment, which
      // is `footnoteSafeId(sourceIdentifier)` for the matching definition.
      // Both sides derive the key from the same identifier through the same
      // encoder, so a label that contains a valid percent-escape (`[^a%41]`,
      // minted verbatim as `fn-a%41`) matches too; decoding the id instead
      // would turn it into `aA` and leave the aggregate `<li>` empty.
      const bodiesBySafeId = extractDefBodiesFromHast(pipeline.hast, clobberPrefix);
      const defs = new Map<
        string,
        { identifier: string; sourceIdentifier: string; contentSource: string; bodyHast: HastElementContent[] }
      >();
      for (const [label, meta] of defMeta) {
        defs.set(label, {
          identifier: meta.identifier,
          sourceIdentifier: meta.sourceIdentifier,
          contentSource: meta.contentSource,
          bodyHast: (bodiesBySafeId.get(footnoteSafeId(meta.sourceIdentifier)) ?? []) as HastElementContent[],
        });
      }
      lastContribution = { registry, symbol: sym, fp, chain };
      registry.contributeChunkData(sym, {
        refs,
        defs,
        linkDefs,
        ownFootnoteLabels: ownLabels.footnoteLabels,
        ownLinkLabels: ownLabels.linkLabels,
      });
    },
  };
}
