/**
 * Aggregate footnote section for cross-chunk coordination.
 *
 * In standalone mode mdast-util-to-hast emits one `<section data-footnotes>`
 * per parse. In coordinated mode (multiple `<AIMarkdown>` chunks sharing a
 * documentId under `<AIMarkdownDocuments>`) each chunk's local section is
 * suppressed (`renderBlocksWithCache` skips the synthetic plan item when
 * `postOptions.registry` is set). This component takes its place: it renders
 * exactly one consolidated `<section data-footnotes>` at the end of each
 * document's LAST mounted chunk, with all defs across chunks in global
 * footnote-number order.
 *
 * Why per-chunk component instead of a sibling: each `<AIMarkdownContent>`
 * already subscribes to its registry via useSyncExternalStore. Rendering the
 * aggregate inside the same component avoids a second subscriber and keeps
 * the footer naturally positioned at the end of the markdown output. When a
 * new chunk mounts and becomes the last, the previously-last chunk's
 * aggregate disappears in the same React commit (returns null), and the new
 * last chunk's aggregate appears.
 *
 * Per-documentId scoping is implicit: registries are keyed by documentId in
 * `useDocumentRegistry`, so the "last chunk" check naturally partitions to
 * one footer per document.
 *
 * @module components/aggregateFootnotesIfLast
 */
import { memo, useMemo, type FC } from 'react';
import { renderHastSubtree } from './markdown';
import type { Registry } from '@ai-markdown/engine';
import { buildAggregateTree } from '@ai-markdown/core';
import type { PostOptions } from './blockMemo';

interface AggregateFootnotesIfLastProps {
  registry: Registry;
  thisChunkSym: symbol;
  clobberPrefix: string;
  postOptions: PostOptions;
  preserveOrphanReferences?: boolean;
}

const AggregateFootnotesIfLastImpl: FC<AggregateFootnotesIfLastProps> = ({
  registry,
  thisChunkSym,
  clobberPrefix,
  postOptions,
  preserveOrphanReferences = false,
}) => {
  // Memoize the hast tree by registry.version + clobberPrefix +
  // preserveOrphanReferences. Without this, every parent re-render walks
  // `registry.chunkOrder` (O(N) per call) and rebuilds the tree even when
  // the underlying registry state is unchanged — the parent re-renders on
  // every `_notify` from any chunk, which scales as O(N) on initial mount.
  // The aggregate is content-determined by (version, prefix, orphan-flag);
  // anything else (postOptions identity changes that don't change render
  // output) is irrelevant to the tree.
  // The "am I the last chunk" test lives INSIDE the factory: every chunk
  // mounts one of these, and only the last one's tree is ever used — with
  // the test outside, every chunk rebuilt the aggregate on every version
  // bump (`buildAggregateTree` is O(chunks × refs)), O(N²) on the initial
  // mount of N chunks (2026-08-19 review r2 P3).
  const tree = useMemo(
    () => {
      const order = registry.chunkOrder;
      if (order.length === 0 || order[order.length - 1] !== thisChunkSym) return null;
      return buildAggregateTree(registry, clobberPrefix, preserveOrphanReferences);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, registry.version, clobberPrefix, preserveOrphanReferences, thisChunkSym]
  );
  if (!tree) return null;
  // Our `tree` is memoised by registry.version, so a non-version-bumping
  // parent re-render re-enters the same cached tree. That is safe without a
  // defensive clone: the visit transform applies urlTransform convergently
  // (recomputed from the original stashed on `element.data` — see
  // `buildTransform`), and `renderHastSubtree` itself clones when a
  // destructive structural filter (element allow/disallow lists, skipHtml)
  // is set on `postOptions` — never the case from `<AIMarkdown>`.
  return <>{renderHastSubtree(tree, postOptions)}</>;
};

export const AggregateFootnotesIfLast = memo(AggregateFootnotesIfLastImpl);
AggregateFootnotesIfLast.displayName = 'AggregateFootnotesIfLast';
