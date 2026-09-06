import { useEffect, useRef } from 'react';
import type { Root as MdastRoot } from 'mdast';
import type { Root as HastRoot, ElementContent as HastElementContent } from 'hast';
import { extractContributions, extractDefBodiesFromHast, type RegistryInternal } from '@ai-react-markdown/engine';

interface ContributionOptions {
  pipeline: { mdast: MdastRoot; hast: HastRoot };
  ownLabels: { footnoteLabels: Set<string>; linkLabels: Set<string> };
  registry: RegistryInternal | null;
  targetPhantoms: { missingFootnotes: Set<string>; missingLinks: Set<string> };
  sym: symbol | null;
  clobberPrefix: string;
  /** Stable identity tuple of parse inputs. Source equality alone cannot
   * validate definition bodies after a plugin or schema change. */
  chain: readonly unknown[];
}

/** Publish source facts only when their fingerprint or parse policy changes.
 * Definition bodies come from the rendered pipeline, preserving plugin output.
 * Registration remains in the renderer; a newly allocated symbol triggers
 * this effect on the next commit, before any contribution can be published. */
export function useRegistryContribution({
  pipeline,
  ownLabels,
  registry,
  targetPhantoms,
  sym,
  clobberPrefix,
  chain,
}: ContributionOptions) {
  const lastContributionRef = useRef<{
    registry: RegistryInternal;
    symbol: symbol;
    fp: string;
    chain: readonly unknown[];
  } | null>(null);
  useEffect(() => {
    if (!registry || !sym) return;
    const refs: {
      label: string;
      kind: 'footnote' | 'link' | 'image';
      referenceType?: 'full' | 'collapsed' | 'shortcut';
    }[] = [];
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
        refs.push({ label: node.label, kind: node.refKind, referenceType: node.referenceType });
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
    const last = lastContributionRef.current;
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
    const bodiesByLabel = extractDefBodiesFromHast(pipeline.hast, clobberPrefix);
    const defs = new Map<
      string,
      { identifier: string; sourceIdentifier: string; contentSource: string; bodyHast: HastElementContent[] }
    >();
    for (const [label, meta] of defMeta) {
      defs.set(label, {
        identifier: meta.identifier,
        sourceIdentifier: meta.sourceIdentifier,
        contentSource: meta.contentSource,
        bodyHast: (bodiesByLabel.get(label) ?? []) as HastElementContent[],
      });
    }
    lastContributionRef.current = { registry, symbol: sym, fp, chain };
    registry.contributeChunkData(sym, {
      refs,
      defs,
      linkDefs,
      ownFootnoteLabels: ownLabels.footnoteLabels,
      ownLinkLabels: ownLabels.linkLabels,
    });
  }, [pipeline, ownLabels, registry, targetPhantoms, sym, clobberPrefix, chain]);
}
