/**
 * Core markdown rendering component.
 *
 * Wraps the local `Markdown` (a vendored fork of react-markdown — see
 * `./markdown/`) with a curated set of remark and rehype plugins for GFM,
 * math/LaTeX, emoji, CJK support, and configurable extra syntax extensions
 * and display optimizations. Plugin selection is driven by the
 * {@link AIMarkdownRenderConfig} from context.
 *
 * ## Render strategy
 *
 * Two render paths gated by `config.blockMemoEnabled` (default `true`):
 *
 * - **Block-memo path** (`BlockMemoizedRenderer`): the rendered hast is cut
 *   into per-block units and memoized across frames by source identity
 *   (`raw + occurrence + ctx + position triple`). Streaming append where
 *   prior blocks are unchanged skips `toJsxRuntime` + React reconcile for
 *   those blocks.
 *
 * - **Legacy path** (`LegacyRenderer`): the vendored `<Markdown>` is called
 *   directly with no cache. Every render runs the full pipeline; output is
 *   byte-identical to the block-memo path (locked in by
 *   `byteEquivalence.test.tsx`).
 *
 * The branch is at the component-tree level: only one of the two child
 * renderers is mounted at a time, so the disabled path pays no `useRef` /
 * `useMemo` cost from block-memo's bookkeeping. Toggling the option at
 * runtime unmounts one and mounts the other (the discarded path's cache
 * is GC'd).
 *
 * ## Performance contract — block-level memoization
 *
 * For the cache to be effective, props that influence rendered output must
 * be referentially stable across renders. This component stabilizes its own
 * plugin arrays via `useMemo`. The outer `<AIMarkdown>` stabilizes
 * `customComponents` via `useStableValue`. If you wire `<AIMarkdownContent>`
 * directly, ensure `customComponents` is memoized at the call site.
 *
 * @module components/MarkdownContent
 */

import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Markdown, { parseStage, transformStage, type Options as MarkdownOptions } from './markdown';

type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>;
type RehypePlugins = NonNullable<MarkdownOptions['rehypePlugins']>;
type RemarkRehypeOptions = NonNullable<MarkdownOptions['remarkRehypeOptions']>;
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import rehypeSanitize from 'rehype-sanitize';
import { sanitizeSchema } from './sanitizeSchema';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import rehypeFooterAdorn from './rehypeFooterAdorn';
import remarkBreaks from 'remark-breaks';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import { remarkMark as remarkMarkHighlight } from 'remark-mark-highlight';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkSmartypants from 'remark-smartypants';
import remarkPangu from 'remark-pangu';
import remarkRemoveComments from 'remark-remove-comments';
import { buildBlocks, createCache, renderBlocksWithCache, type Cache, type PostOptions } from './blockMemo';
import { useAIMarkdownRenderState } from '../context';
import {
  AIMarkdownCustomComponents,
  AIMarkdownRenderDisplayOptimizeAbility,
  AIMarkdownRenderExtraSyntax,
} from '../defs';
import { collectDefLabels } from './collectDefLabels';
import { useDocumentRegistry, usePreserveOrphanReferences } from './AIMarkdownDocuments';
import type { Registry } from './documentRegistry';
import { augmentSourceWithPhantoms } from './remarkInjectPhantomDefs';
import { buildCrossChunkHandlers } from './customMdastHandlers';
import { normalizeForMatch } from './normalizeId';
import { crossChunkComponents } from './crossChunkPlaceholders';
import { extractContributions } from './extractContributions';
import { extractDefBodiesFromHast } from './extractDefBodiesFromHast';
import { AggregateFootnotesIfLast } from './aggregateFootnotesIfLast';
import { ChunkSymbolContext } from './chunkSymbolContext';
import type { ElementContent as HastElementContent } from 'hast';

/** Module-level SSR snapshot constant for useSyncExternalStore. Hoisted out
 *  of the component so its identity is stable across renders (a fresh `() => 0`
 *  every render would defeat the snapshot-stability guarantees the hook
 *  relies on). */
const REGISTRY_SSR_SNAPSHOT = () => 0;

/** Maps display optimization abilities to their corresponding remark plugins. */
const DisplayOptimizeRemarkPluginMap = {
  [AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS]: remarkRemoveComments,
  [AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS]: remarkSmartypants,
  [AIMarkdownRenderDisplayOptimizeAbility.PANGU]: remarkPangu,
};

/** Maps extra syntax extensions to their corresponding remark plugins. */
const ExtraSyntaxRemarkPluginMap = {
  [AIMarkdownRenderExtraSyntax.HIGHLIGHT]: remarkMarkHighlight,
  [AIMarkdownRenderExtraSyntax.DEFINITION_LIST]: remarkDefinitionList,
};

/** Stable empty object to avoid unnecessary re-renders when no custom components are given. */
const DefaultCustomComponents: AIMarkdownCustomComponents = {};

interface AIMarkdownContentProps {
  /** Preprocessed markdown string to render. */
  content: string;
  /** Optional react-markdown component overrides (e.g. custom code block renderer). */
  customComponents?: AIMarkdownCustomComponents;
}

interface RendererProps {
  content: string;
  usedComponents: AIMarkdownCustomComponents;
  remarkPlugins: RemarkPlugins;
  rehypePlugins: RehypePlugins;
  remarkRehypeOptions: RemarkRehypeOptions;
}

/**
 * Block-memo render path. Mounted when `config.blockMemoEnabled === true`.
 * Encapsulates the `useRef`-backed cache, G3 sync flush, and the three-stage
 * unified pipeline (parse → transform → buildBlocks → renderBlocksWithCache).
 */
const BlockMemoizedRenderer = memo(
  ({ content, usedComponents, remarkPlugins, rehypePlugins, remarkRehypeOptions }: RendererProps) => {
    // Vendored Markdown options that AIMarkdown does not currently expose. They
    // are tracked in the G3 flush below so the cache stays correct if any of
    // these are ever surfaced upstream.
    const urlTransform: MarkdownOptions['urlTransform'] = undefined;
    const allowedElements: MarkdownOptions['allowedElements'] = undefined;
    const disallowedElements: MarkdownOptions['disallowedElements'] = undefined;
    const allowElement: MarkdownOptions['allowElement'] = undefined;
    const skipHtml: MarkdownOptions['skipHtml'] = undefined;
    const unwrapDisallowed: MarkdownOptions['unwrapDisallowed'] = undefined;

    // ─── Cross-chunk coordination wiring (Phase 11) ──────────────────────────
    // All effects below are NO-OP when `registry === null` (standalone mode
    // without `<AIMarkdownDocuments>`): the gating is on `registry` truthiness.
    const { documentId, clobberPrefix, config } = useAIMarkdownRenderState();
    const reactId = useId();
    const registry = useDocumentRegistry(documentId);
    // Allocate-and-publish state: the Symbol for THIS chunk PAIRED with the
    // registry it was allocated from. Modelling as state — instead of a
    // ref — makes both fields real deps for downstream effects, so React's
    // dep system (not microtask FIFO) enforces "allocate before contribute"
    // ordering.
    //
    // Why the registry is bundled with sym: a parent that re-renders with a
    // different `documentId` (read from context) causes `registry` to flip
    // to a NEW Registry instance on the next render. React retains state
    // across that render, so `sym` still holds the OLD registry's Symbol
    // until Effect 1's cleanup runs and clears it. If Effect 2 reads `sym`
    // directly during that gap, it contributes the stale Symbol into the
    // NEW registry — polluting `chunkData` with an unowned entry that
    // `onEmpty`'s `chunkData.size === 0` check never sees as gone, leaking
    // the registry. Storing the registry alongside the sym lets Effect 2
    // gate on `allocation.registry === registry` and skip the stale tick.
    const [allocation, setAllocation] = useState<{ registry: Registry; sym: symbol } | null>(null);
    const sym = allocation && allocation.registry === registry ? allocation.sym : null;

    // Subscribe to registry version changes. Without this, useMemo deps that
    // include `registry?.version` would never re-evaluate — useMemo only re-
    // runs when its component re-renders, and a version bump from another
    // chunk's contribute step doesn't trigger our re-render on its own.
    // useSyncExternalStore's subscribe handle does the wake-up: when any
    // chunk calls registry._notify, every subscribed renderer re-renders,
    // PASS 0.5 picks up new labelSet entries, PASS 1 augments + re-parses,
    // placeholder hast tags emerge, and the placeholder components (which
    // also useSyncExternalStore) resolve their numbers/URLs.
    // Subscribe identity must be stable across renders — useSyncExternalStore
    // resubscribes whenever `subscribe` changes identity, so an inline
    // `(cb) => ...` would trigger unsubscribe+resubscribe on every render.
    // For N coordinated chunks each waking on every notify, that's O(N²)
    // subscriber-list churn during initial mount.
    const subscribeRegistry = useCallback(
      (cb: () => void) => (registry ? registry.subscribe(cb) : () => {}),
      [registry]
    );
    const getRegistryVersion = useCallback(() => registry?.version ?? 0, [registry]);
    useSyncExternalStore(subscribeRegistry, getRegistryVersion, REGISTRY_SSR_SNAPSHOT);

    // PASS 0: lightweight def-label scan, then publish to registry.labelSet.
    const ownLabels = useMemo(() => collectDefLabels(content ?? ''), [content]);

    useEffect(() => {
      if (!registry) return;
      const s = registry.registerChunk(reactId, ownLabels.footnoteLabels, ownLabels.linkLabels);
      setAllocation({ registry, sym: s });
      return () => {
        registry.releaseSymbol(reactId);
        setAllocation(null);
      };
    }, [reactId, registry, ownLabels]);

    // G3 — synchronous deps-diff flush. Discards the per-block cache when any
    // option that affects rendered output (but not parse output) changes
    // identity. The check runs synchronously at the top of render: an
    // `useEffect` would only fire after commit, by which time the current
    // render has already read from the (now stale) cache and emitted incorrect
    // output. The cache is best-effort memoization across renders, not state
    // the UI depends on for correctness — concurrent render aborts are safe
    // because (a) cache hits return identical node references, and (b) cache
    // misses always recompute from inputs that are themselves pure.
    //
    // Cache-memoization pattern documented above is an established exception
    // to the React Compiler purity check (rule renamed across react-hooks
    // plugin versions, so the previous block disable no longer suppresses
    // anything in v7+). See design `/tmp/phase5-block-memo-decisions.md` §4.
    const cacheRef = useRef<Cache>(createCache());
    const depsRef = useRef<{
      usedComponents: typeof usedComponents;
      remarkPlugins: typeof remarkPlugins;
      rehypePlugins: typeof rehypePlugins;
      remarkRehypeOptions: typeof remarkRehypeOptions;
      urlTransform: typeof urlTransform;
      allowedElements: typeof allowedElements;
      disallowedElements: typeof disallowedElements;
      allowElement: typeof allowElement;
      skipHtml: typeof skipHtml;
      unwrapDisallowed: typeof unwrapDisallowed;
      registry: Registry | null;
      symbol: symbol | null;
    }>({
      usedComponents,
      remarkPlugins,
      rehypePlugins,
      remarkRehypeOptions,
      urlTransform,
      allowedElements,
      disallowedElements,
      allowElement,
      skipHtml,
      unwrapDisallowed,
      registry,
      symbol: sym,
    });
    if (
      depsRef.current.usedComponents !== usedComponents ||
      depsRef.current.remarkPlugins !== remarkPlugins ||
      depsRef.current.rehypePlugins !== rehypePlugins ||
      depsRef.current.remarkRehypeOptions !== remarkRehypeOptions ||
      depsRef.current.urlTransform !== urlTransform ||
      depsRef.current.allowedElements !== allowedElements ||
      depsRef.current.disallowedElements !== disallowedElements ||
      depsRef.current.allowElement !== allowElement ||
      depsRef.current.skipHtml !== skipHtml ||
      depsRef.current.unwrapDisallowed !== unwrapDisallowed ||
      depsRef.current.registry !== registry ||
      depsRef.current.symbol !== sym
    ) {
      cacheRef.current = createCache();
      depsRef.current = {
        usedComponents,
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions,
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
        registry,
        symbol: sym,
      };
    }

    // PASS 0.5: which labels does this chunk reference that are defined
    // elsewhere? Substring over-approximation: normalize content (resolve \X +
    // ws-collapse + uppercase) and check against the registry's union labelSet.
    // labelSet entries are already normalized; any standard ref form contains
    // the label as substring after normalization. False-positive (wasted
    // reparse) acceptable; false-negative for backslash-escaped / multi-line
    // whitespace labels accepted as v1 limit.
    //
    // Stable reference: every `registry._notify` (3× per chunk on mount: alloc,
    // contributeLabels, contributeChunkData) bumps `registry.version`, which is
    // a useMemo dep here. Without ref-stability, every bump produces fresh Set
    // instances → `parsed` useMemo invalidates → full re-parse runs. With N
    // chunks coordinating, that's O(N²) parses at mount and a visible white
    // screen for 30+ chunks. We compare the freshly-computed Sets to the
    // previous result via a ref and return the previous reference when the
    // contents are identical — collapsing the cascade to one parse per chunk.
    const targetPhantomsRef = useRef<{ missingFootnotes: Set<string>; missingLinks: Set<string> }>({
      missingFootnotes: new Set<string>(),
      missingLinks: new Set<string>(),
    });
    const targetPhantoms = useMemo(() => {
      let nextFootnotes: Set<string>;
      let nextLinks: Set<string>;
      if (!registry) {
        nextFootnotes = new Set<string>();
        nextLinks = new Set<string>();
      } else {
        const normalized = normalizeForMatch(content ?? '');
        nextFootnotes = new Set<string>();
        nextLinks = new Set<string>();
        for (const label of registry.labelSet.footnoteLabels) {
          if (ownLabels.footnoteLabels.has(label)) continue;
          if (normalized.includes(label)) nextFootnotes.add(label);
        }
        for (const label of registry.labelSet.linkLabels) {
          if (ownLabels.linkLabels.has(label)) continue;
          if (normalized.includes(label)) nextLinks.add(label);
        }
      }
      const prev = targetPhantomsRef.current;
      if (
        nextFootnotes.size === prev.missingFootnotes.size &&
        nextLinks.size === prev.missingLinks.size &&
        [...nextFootnotes].every((l) => prev.missingFootnotes.has(l)) &&
        [...nextLinks].every((l) => prev.missingLinks.has(l))
      ) {
        return prev;
      }
      const next = { missingFootnotes: nextFootnotes, missingLinks: nextLinks };
      targetPhantomsRef.current = next;
      return next;
      // version is the freshness anchor (subscribe in placeholder components handles re-render)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registry, registry?.version, content, ownLabels]);

    const effectivePreserveOrphan = usePreserveOrphanReferences(config.preserveOrphanReferences);
    // In coordinated client renders, def-only chunks may be referenced by
    // other chunks even when visible orphan rendering is disabled. Once this
    // chunk has a Symbol, keep real defs in the synthetic footer so
    // extractDefBodiesFromHast can harvest their post-pipeline bodyHast; the
    // aggregate footer below still uses effectivePreserveOrphan to decide
    // whether unreferenced defs are visible.
    const preserveForBodyHarvest = effectivePreserveOrphan || Boolean(registry && sym);

    // PASS 1: full parse on (possibly) augmented source, with custom handlers
    // wired through remarkRehypeOptions.
    //
    // Two activation conditions:
    //   1. `registry` present → coordinated mode → ALL 4 handlers (Direction A
    //      orphan protection + Direction B cross-chunk ref placeholders).
    //   2. `registry` absent + `effectivePreserveOrphan` → standalone mode →
    //      ONLY `footnoteDefinition` handler (Direction A orphan protection
    //      via state.footnoteOrder push). The other 3 handlers must NOT run in
    //      standalone, otherwise:
    //        - `footnoteReference` would emit `<footnote-sup>` placeholder
    //          which depends on registry for the number → renders null → all
    //          standalone footnotes disappear (regression).
    //        - `linkReference`/`imageReference` would emit cross-chunk-*
    //          placeholders that also depend on registry → broken links.
    const handlers = useMemo(() => {
      if (registry) return buildCrossChunkHandlers();
      if (effectivePreserveOrphan) {
        const { footnoteDefinition } = buildCrossChunkHandlers();
        return { footnoteDefinition };
      }
      return undefined;
    }, [registry, effectivePreserveOrphan]);

    // Stage 1 + 2: parse → run remark/rehype pipeline. The `parsed.mdast` is
    // mutated in place during `transformStage`; the useMemo chain below keeps
    // ordering correct for `buildBlocks`.
    const parsed = useMemo(() => {
      const augmented = augmentSourceWithPhantoms(content ?? '', targetPhantoms);
      const baseHandlers = remarkRehypeOptions?.handlers ?? {};
      const mergedRemarkRehypeOptions = handlers
        ? {
            ...remarkRehypeOptions,
            handlers: { ...baseHandlers, ...handlers },
            // Phantom label sets are empty in standalone mode (no PASS 0.5
            // injection happened); the footnoteDefinition handler still reads
            // them via `state.options.phantomFootnoteLabels.has(id)`, which
            // returns false for every id → orphan-protect path proceeds.
            phantomFootnoteLabels: targetPhantoms.missingFootnotes,
            phantomLinkLabels: targetPhantoms.missingLinks,
            preserveOrphan: preserveForBodyHarvest,
            documentId,
          }
        : {
            ...remarkRehypeOptions,
          };
      return parseStage({
        children: augmented,
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions: mergedRemarkRehypeOptions as RemarkRehypeOptions,
      });
    }, [
      content,
      targetPhantoms,
      remarkPlugins,
      rehypePlugins,
      remarkRehypeOptions,
      handlers,
      preserveForBodyHarvest,
      documentId,
    ]);
    const hast = useMemo(() => transformStage(parsed), [parsed]);

    // Cut hast into per-block units indexed back to mdast for cache identity,
    // and compute the document-wide ctx digest for cross-block invalidation.
    const built = useMemo(() => buildBlocks(parsed.mdast, hast, content ?? ''), [parsed.mdast, hast, content]);

    const postOptions = useMemo<PostOptions>(
      () => ({
        components: { ...crossChunkComponents, ...usedComponents },
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
        // v6 fingerprint cache fields:
        registry: registry ?? undefined,
        thisChunkSymbol: sym ?? undefined,
        clobberPrefix,
      }),
      // `sym` is now real state (setSym after allocateSymbol), so it's a
      // proper dep and postOptions refreshes when allocation completes.
      // `registry?.version` stays in deps so the per-block fingerprint cache
      // path sees the latest registry version on every coordinated update.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        usedComponents,
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
        registry,
        registry?.version,
        sym,
        clobberPrefix,
      ]
    );

    // Post-PASS-1 contribute: walk the parsed mdast and publish refs/defs
    // back to the registry so other chunks can resolve cross-chunk labels.
    //
    // Guarded by a fingerprint to prevent an infinite re-render cascade:
    // contributeChunkData calls _notify → version++ → useSyncExternalStore
    // wakes this renderer → targetPhantoms recomputes (fresh Set instances)
    // → parsed re-runs (new mdast reference) → this effect would re-fire
    // and re-contribute the same data → loop. Comparing serialized payload
    // to last contribution breaks the cycle at the side-effect layer.
    //
    // Ordering: `sym` is in the dep array, so this effect re-fires after the
    // allocate effect commits its setSym(...). The previous microtask/flushSync
    // dance is gone; React's dep system enforces "allocate before contribute".
    const lastContributionRef = useRef<{
      registry: Registry;
      symbol: symbol;
      fp: string;
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
      for (const node of extractContributions(parsed.mdast, {
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
      if (
        lastContributionRef.current?.registry === registry &&
        lastContributionRef.current.symbol === sym &&
        lastContributionRef.current.fp === fp
      ) {
        return;
      }
      // Fingerprint changed → harvest bodyHast from the post-pipeline hast
      // and publish. Missing entries are defensive: after allocation,
      // preserveForBodyHarvest keeps real local defs in the synthetic footer
      // even when visible orphan rendering is disabled.
      const bodiesByLabel = extractDefBodiesFromHast(hast, clobberPrefix);
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
      lastContributionRef.current = { registry, symbol: sym, fp };
      registry.contributeChunkData(sym, {
        refs,
        defs,
        linkDefs,
        ownFootnoteLabels: ownLabels.footnoteLabels,
        ownLinkLabels: ownLabels.linkLabels,
      });
    }, [parsed, ownLabels, registry, targetPhantoms, sym, hast, clobberPrefix]);

    // Intentional cache memoization via cacheRef; see G3 comment above.
    const rendered = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, postOptions);

    // React keys come from buildBlocks:
    //   - `block-${hastOffset}` for cacheable blocks (the hast element's own
    //     source offset, NOT the mdast offset — this is what makes multi-root
    //     raw HTML produce unique keys when two hast siblings share one mdast
    //     html node)
    //   - `__footnote_section__` for the synthetic footnote section (fixed
    //     literal lets its fiber state survive toggle T1→T2→T3)
    //   - `inline-${offset}` for top-level whitespace / sanitized comments,
    //     falling back to `inline-i${planIndex}` if the inline has no position
    // In coordinated mode, the per-chunk synthetic `<section data-footnotes>`
    // is suppressed by renderBlocksWithCache (postOptions.registry present).
    // Render the aggregate footer here so it sits at the end of the LAST
    // chunk's output. The component is a no-op when this chunk is not last.
    return (
      <ChunkSymbolContext.Provider value={sym}>
        {rendered.map(({ node, reactKey }) => (
          <Fragment key={reactKey}>{node}</Fragment>
        ))}
        {registry && sym ? (
          <AggregateFootnotesIfLast
            registry={registry}
            thisChunkSym={sym}
            clobberPrefix={clobberPrefix}
            postOptions={postOptions}
            preserveOrphanReferences={effectivePreserveOrphan}
          />
        ) : null}
      </ChunkSymbolContext.Provider>
    );
  }
);
BlockMemoizedRenderer.displayName = 'BlockMemoizedRenderer';

/**
 * Legacy render path. Mounted when `config.blockMemoEnabled === false`.
 * Calls the vendored `<Markdown>` directly — every render runs the full
 * pipeline end-to-end with no cross-frame reuse. Output is byte-identical
 * to the block-memo path in standalone mode (validated by
 * `byteEquivalence.test.tsx`).
 *
 * **Cross-chunk coordination (Phase 11) is NOT wired through this path.**
 * Wrapping `<AIMarkdown>` with `<AIMarkdownDocuments>` while keeping
 * `blockMemoEnabled: false` silently runs without coordination — orphan
 * defs are not protected, refs across chunks don't resolve. If you need
 * cross-chunk behavior, keep `blockMemoEnabled: true` (the default).
 */
const LegacyRenderer = memo(
  ({ content, usedComponents, remarkPlugins, rehypePlugins, remarkRehypeOptions }: RendererProps) => (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={remarkRehypeOptions}
      components={usedComponents}
    >
      {content}
    </Markdown>
  )
);
LegacyRenderer.displayName = 'LegacyRenderer';

/**
 * Internal component that assembles the remark/rehype plugin chain based on
 * the current render config, then dispatches to either the block-memo
 * renderer or the legacy renderer based on `config.blockMemoEnabled`.
 */
const AIMarkdownContent = memo(({ content, customComponents }: AIMarkdownContentProps) => {
  const { config, clobberPrefix } = useAIMarkdownRenderState();

  // Resolve extra-syntax remark plugins and check if definition list HAST handlers are needed.
  const { extraSyntaxRemarkPlugins, enableDefinitionList } = useMemo(
    () => ({
      extraSyntaxRemarkPlugins: config.extraSyntaxSupported.map((syntax) => ExtraSyntaxRemarkPluginMap[syntax]),
      enableDefinitionList: config.extraSyntaxSupported.includes(AIMarkdownRenderExtraSyntax.DEFINITION_LIST),
    }),
    [config.extraSyntaxSupported]
  );

  const displayOptimizeRemarkPlugins = useMemo(() => {
    return config.displayOptimizeAbilities.map((ability) => DisplayOptimizeRemarkPluginMap[ability]);
  }, [config.displayOptimizeAbilities]);

  const usedComponents = useMemo(() => {
    return customComponents ? { ...DefaultCustomComponents, ...customComponents } : DefaultCustomComponents;
  }, [customComponents]);

  // Stable plugin/options arrays so this component's React.memo wrapper can
  // skip re-renders when only the parent re-rendered. The vendored
  // `parseStage` rebuilds the unified processor on every call regardless —
  // there is no internal processor cache to feed.
  const remarkPlugins = useMemo<RemarkPlugins>(
    () => [
      // --- Core plugins (always active) ---
      remarkGfm,
      [
        remarkMath,
        {
          // Disable single-dollar inline math to avoid conflicts with currency
          // signs and other dollar usages; the preprocessor converts $...$ to $$...$$.
          singleDollarTextMath: false,
        },
      ],
      // --- Configurable extra syntax plugins ---
      ...extraSyntaxRemarkPlugins,
      // --- Formatting & normalization ---
      remarkBreaks,
      remarkEmoji,
      remarkSqueezeParagraphs,
      remarkCjkFriendly,
      remarkCjkFriendlyGfmStrikethrough,
      // --- Configurable display optimizations ---
      ...displayOptimizeRemarkPlugins,
    ],
    [extraSyntaxRemarkPlugins, displayOptimizeRemarkPlugins]
  );

  const rehypePlugins = useMemo<RehypePlugins>(
    () => [
      // Allow raw HTML through so rehype-sanitize can handle it.
      [rehypeRaw, { passThrough: [] }],
      // Sanitize HTML while allowing <mark> (highlight) and KaTeX class names.
      // Override `clobberPrefix` with the instance-scoped value so every id
      // and clobberable attribute is namespaced to this `<AIMarkdown>` instance.
      [rehypeSanitize, { ...sanitizeSchema, clobberPrefix }],
      // Normalize the auto-generated `<section data-footnotes>`: strip the
      // sr-only `<h2>Footnotes</h2>` label and prepend `<hr>`. Keeps standalone
      // single-doc rendering visually consistent with the cross-chunk aggregate
      // footer (which builds the same shape from scratch).
      rehypeFooterAdorn,
      // Re-prefix intra-document hash hrefs so they match the ids that
      // rehype-sanitize just clobbered. Must use the SAME prefix as the schema
      // above — that's why both read from `clobberPrefix`.
      [rehypeRebaseHashLinks, { prefix: clobberPrefix }],
      rehypeKatex,
      rehypeUnwrapImages,
    ],
    [clobberPrefix]
  );

  const remarkRehypeOptions = useMemo<RemarkRehypeOptions>(
    () => ({
      allowDangerousHtml: true,
      // Suppress mdast-util-to-hast's `user-content-` prefix on footnote
      // ids/hrefs; rehype-sanitize will apply the same prefix downstream
      // and `rehypeRebaseHashLinks` mirrors it onto matching hash hrefs.
      // Without this, ids would end up double-prefixed
      // (`user-content-user-content-fn-x`).
      clobberPrefix: '',
      handlers: {
        // Inject definition-list HAST handlers when the extension is active.
        ...(enableDefinitionList ? defListHastHandlers : {}),
      },
    }),
    [enableDefinitionList]
  );

  const Renderer = config.blockMemoEnabled ? BlockMemoizedRenderer : LegacyRenderer;
  return (
    <Renderer
      content={content}
      usedComponents={usedComponents}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={remarkRehypeOptions}
    />
  );
});

AIMarkdownContent.displayName = 'AIMarkdownContent';

export default AIMarkdownContent;
