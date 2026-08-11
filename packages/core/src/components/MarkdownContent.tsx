/**
 * Core markdown rendering component.
 *
 * Wraps the local `Markdown` (a vendored fork of react-markdown — see
 * `./markdown/`) with a curated set of remark and rehype plugins for GFM,
 * math/LaTeX, emoji, CJK support, and selectable extra syntax extensions
 * and display optimizations. Plugin selection is driven by the resolved
 * `enginePlugins` internal prop (sealed plugin objects).
 *
 * ## Render strategy
 *
 * Two render paths gated by the resolved `blockMemo` value (default `true`):
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
 * `customComponents` at its stability firewall. If you wire
 * `<AIMarkdownContent>` directly, ensure `customComponents` is memoized at
 * the call site.
 *
 * @module components/MarkdownContent
 */

import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Markdown, { parseStage, transformStage, defaultUrlTransform, type Options as MarkdownOptions } from './markdown';

type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>;
type RehypePlugins = NonNullable<MarkdownOptions['rehypePlugins']>;
type RemarkRehypeOptions = NonNullable<MarkdownOptions['remarkRehypeOptions']>;
import { sanitizeSchema } from '@ai-react-markdown/engine';
import { buildBlocks, createCache, renderBlocksWithCache, type Cache, type PostOptions } from './blockMemo';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins, buildCoreRemarkRehypeOptions } from './pluginChain';
import { advanceIncrementalParse, type IncrementalParseState } from './incrementalParse';
import { measureStage } from '@ai-react-markdown/engine';
import { useAIMarkdownDocument, useAIMarkdownState } from '../context';
import { deriveTailSignal } from './streamingCursor/tailSignal';
import { AIMarkdownCustomComponents } from '../defs';
import type { AIMarkdownEnginePlugin } from '../plugins/defs';
import { collectDefLabels, createDefLabelScanner, type DefLabelScanner } from './collectDefLabels';
import { useDocumentRegistry, usePreserveOrphanReferences } from './AIMarkdownDocuments';
import type { RegistryInternal } from './documentRegistry';
import type { SanitizeSchema } from '@ai-react-markdown/engine';
import { buildPhantomSuffix } from './remarkInjectPhantomDefs';
import { buildCrossChunkHandlers } from './customMdastHandlers';
import { normalizeForMatch } from '@ai-react-markdown/engine';
import { crossChunkComponents } from './crossChunkPlaceholders';
import { CrossChunkUrlContext, type CrossChunkUrlPolicy } from './crossChunkUrlContext';
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

/** Stable empty object to avoid unnecessary re-renders when no custom components are given. */
const DefaultCustomComponents: AIMarkdownCustomComponents = {};

/** Stable empty result for the PASS 0 def-label scan in standalone mode
 *  (no registry). One shared frozen instance so `ownLabels` keeps the same
 *  identity across every render — downstream effects and memos that list it
 *  as a dep never churn while uncoordinated. */
const EMPTY_DEF_LABELS: ReturnType<typeof collectDefLabels> = Object.freeze({
  footnoteLabels: new Set<string>(),
  linkLabels: new Set<string>(),
});

interface AIMarkdownContentProps {
  /** Preprocessed markdown string to render. */
  content: string;
  /** Optional react-markdown component overrides (e.g. custom code block renderer). */
  customComponents?: AIMarkdownCustomComponents;
  /**
   * Optional URL transform applied during the hast pipeline. When omitted,
   * the vendored Markdown wrapper falls back to its built-in
   * `defaultUrlTransform` (https/mailto/etc. allowlist).
   */
  urlTransform?: MarkdownOptions['urlTransform'];
  /**
   * Optional `rehype-sanitize` schema. When omitted, the library default
   * is used (not publicly exported as a value — see
   * {@link extendSanitizeSchema}). Callers should produce this via
   * {@link extendSanitizeSchema} to avoid silently dropping the cross-chunk
   * tag allowlist.
   */
  sanitizeSchema?: SanitizeSchema;
  // ── Resolved engine values ──
  // Passed field-by-field from `<AIMarkdown>`'s single resolution point.
  /** Renderer dispatch: block-memo path (`true`) vs legacy path (`false`). */
  blockMemo: boolean;
  /** Incremental (prefix-freeze) parse gate. */
  incrementalParse: boolean;
  /** Orphan-reference policy (standalone mode; `<AIMarkdownDocuments>` overrides via its own chain). */
  preserveOrphanReferences: boolean;
  /** Resolved sealed-plugin selection (sanitized; absent prop already defaulted upstream). */
  enginePlugins: readonly AIMarkdownEnginePlugin[];
}

interface RendererProps {
  content: string;
  usedComponents: AIMarkdownCustomComponents;
  remarkPlugins: RemarkPlugins;
  rehypePlugins: RehypePlugins;
  remarkRehypeOptions: RemarkRehypeOptions;
  urlTransform: MarkdownOptions['urlTransform'];
  /** Incremental-parse gate (resolved). */
  incrementalParse: boolean;
  /** Resolved orphan-reference policy (standalone tier of the override chain). */
  preserveOrphanReferences: boolean;
  /**
   * Whether the definition-list plugin is in the active chain. Feeds the
   * boundary scanner's syntax awareness (`computeFreezeBoundary`'s
   * `defListEnabled`) — the scanner must know the boundary rules of every
   * active multiline construct.
   */
  defListEnabled: boolean;
  /** Resolved sanitize schema. Propagated to cross-chunk placeholders via
   *  {@link CrossChunkUrlContext} so they can apply the same `protocols.*`
   *  allowlist that `rehype-sanitize` applies to in-tree `<a>`/`<img>` —
   *  see `crossChunkUrlSanitize.ts` for why this must happen at render
   *  time rather than at contribute time. */
  sanitizeSchema: SanitizeSchema;
}

/**
 * Block-memo render path. Mounted when the resolved `blockMemo` is `true`.
 * Encapsulates the `useRef`-backed cache, G3 sync flush, and the three-stage
 * unified pipeline (parse → transform → buildBlocks → renderBlocksWithCache).
 */
const BlockMemoizedRenderer = memo(
  ({
    content,
    usedComponents,
    remarkPlugins,
    rehypePlugins,
    remarkRehypeOptions,
    urlTransform,
    sanitizeSchema: usedSanitizeSchema,
    incrementalParse,
    preserveOrphanReferences,
    defListEnabled,
  }: RendererProps) => {
    // Vendored Markdown options that AIMarkdown does not currently expose. They
    // are tracked in the G3 flush below so the cache stays correct if any of
    // these are ever surfaced upstream. `urlTransform` is now a real prop —
    // the remaining five are still internal `undefined`.
    const allowedElements: MarkdownOptions['allowedElements'] = undefined;
    const disallowedElements: MarkdownOptions['disallowedElements'] = undefined;
    const allowElement: MarkdownOptions['allowElement'] = undefined;
    const skipHtml: MarkdownOptions['skipHtml'] = undefined;
    const unwrapDisallowed: MarkdownOptions['unwrapDisallowed'] = undefined;

    // ─── Cross-chunk coordination wiring (Phase 11) ──────────────────────────
    // All effects below are NO-OP when `registry === null` (standalone mode
    // without `<AIMarkdownDocuments>`): the gating is on `registry` truthiness.
    const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
    const reactId = useId();
    // The runtime value behind `useDocumentRegistry` is always a
    // `RegistryInternal` (see `createRegistry`); the public hook narrows
    // the return type to `Registry` so external consumers don't see the
    // mutator methods. Here — the canonical internal coordinator — we
    // widen back to `RegistryInternal` once at the top so subsequent
    // mutator calls (`registerChunk`, `releaseSymbol`, `contributeChunkData`)
    // type-check without scattered `as` casts.
    const registry = useDocumentRegistry(documentId, documentIdExplicit) as RegistryInternal | null;
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
    const [allocation, setAllocation] = useState<{ registry: RegistryInternal; sym: symbol } | null>(null);
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

    // PASS 0: def-label scan, then publish to registry.labelSet.
    //
    // Coordinated mode ONLY. Despite the "lightweight" framing in
    // collectDefLabels' docs, it is a full second remark-parse of the
    // content (def-only pipeline, but parsing is parsing), and every
    // consumer of `ownLabels` — the register effect below, targetPhantoms,
    // the contribute effect — no-ops without a registry. Running it in
    // standalone mode doubles the per-token parse cost of a streaming
    // render for output nobody reads (measured at ~1/3 of total commit
    // time on the BlockMemoCompare story). Skip it entirely and hand back
    // a stable empty result so downstream deps never churn.
    //
    // Coordinated mode goes through an append-aware scanner: while a token
    // stream appends prose that can't contain a definition, the previous
    // result is returned by REFERENCE — no re-parse, and the register
    // effect below (which lists `ownLabels` as a dep) stops re-registering
    // the chunk on every token. When a definition MAY be present, the
    // scanner freezes the settled prefix at an engine-verified boundary and
    // re-parses only the live tail. It stays convergent — equal to a full
    // parse at every step, with non-append input resetting all cached
    // state — so StrictMode double-invokes and aborted renders can't
    // poison it.
    const defScannerRef = useRef<DefLabelScanner | null>(null);
    const ownLabels = useMemo(() => {
      if (!registry) return EMPTY_DEF_LABELS;
      const scanner = (defScannerRef.current ??= createDefLabelScanner());
      return scanner.scan(content ?? '');
    }, [content, registry]);

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
    // Every stage measurement in this component MUST carry this instance's
    // documentId — a stageInstanceId-scoped subscriber silently drops
    // unattributed emissions (the panel then shows "0 ms ×0", which reads
    // as "stage never ran"). The bound wrapper makes forgetting impossible
    // at call sites; do not call the bare measureStage here.
    const measureHere = useCallback(
      <T,>(stage: Parameters<typeof measureStage>[0], fn: () => T): T => measureStage(stage, fn, documentId),
      [documentId]
    );

    const cacheRef = useRef<Cache>(createCache());
    // Incremental-parse state (previous frame's content + post-transform
    // trees + verified freeze boundary). Render-phase ref mutation, same
    // pattern as `defScannerRef`/`cacheRef`. Cleared by the G3 flush below
    // (belt-and-suspenders — the engine's own depsKey gate, which covers
    // MORE inputs than G3's 12 fields, is the primary invalidation).
    const incrementalStateRef = useRef<IncrementalParseState | null>(null);
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
      registry: RegistryInternal | null;
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
      incrementalStateRef.current = null;
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
    // instances → `pipeline` useMemo invalidates → full re-parse runs. With N
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
        nextFootnotes = new Set<string>();
        nextLinks = new Set<string>();
        // Candidates first, normalization second: phantom targets can only
        // be labels defined by OTHER chunks, and in the common case (single
        // chunk, or no defs elsewhere) there are none. normalizeForMatch is
        // two full-content regex passes plus toUpperCase — per token — so
        // skipping it when there is nothing to look for removes the
        // dominant PASS 0 cost left after the append-aware label scanner.
        const candidateFootnotes: string[] = [];
        for (const label of registry.labelSet.footnoteLabels) {
          if (!ownLabels.footnoteLabels.has(label)) candidateFootnotes.push(label);
        }
        const candidateLinks: string[] = [];
        for (const label of registry.labelSet.linkLabels) {
          if (!ownLabels.linkLabels.has(label)) candidateLinks.push(label);
        }
        if (candidateFootnotes.length > 0 || candidateLinks.length > 0) {
          const normalized = normalizeForMatch(content ?? '');
          for (const label of candidateFootnotes) {
            if (normalized.includes(label)) nextFootnotes.add(label);
          }
          for (const label of candidateLinks) {
            if (normalized.includes(label)) nextLinks.add(label);
          }
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

    const effectivePreserveOrphan = usePreserveOrphanReferences(preserveOrphanReferences);
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

    // Stage 1 + 2: parse → run remark/rehype pipeline, as ONE memo returning
    // `{ mdast, hast }`. Merged (formerly separate `parsed`/`hast` memos)
    // because the incremental-parse engine owns both stages: on a splice it
    // reuses the frozen prefix of the previous frame's post-transform trees
    // and runs parse+transform over the tail only.
    const pipeline = useMemo(() => {
      const phantomSuffix = buildPhantomSuffix(targetPhantoms);
      const augmented = (content ?? '') + phantomSuffix;
      const baseHandlers = remarkRehypeOptions?.handlers ?? {};
      const mergedRemarkRehypeOptions = (
        handlers
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
            }
      ) as RemarkRehypeOptions;

      // Coordinated (registry) mode is incremental-eligible since v2: the
      // engine takes the phantom suffix as a separate always-tail input (its
      // frame-to-frame churn re-parses only the tail — the reference taint
      // keeps every phantom-resolved ref out of the frozen prefix), and the
      // contribute effect's inputs are covered by splice equivalence (mdast)
      // plus the replay-regenerated footer (hast). When the flag is off, the
      // state is CLEARED — a later eligible frame must never splice against
      // trees parsed under different conditions.
      //
      // SSR takes this branch too: the engine's first-frame scan exists to
      // seed the NEXT frame's checkpoint, and a per-request server render
      // has no next frame — routing through the engine would pay a dead
      // O(document) line-lex per request. Hydration is unaffected (the
      // client's first frame rebuilds from null either way).
      if (!incrementalParse || typeof window === 'undefined') {
        incrementalStateRef.current = null;
        // Dev-only stage telemetry (`ai-markdown:stage:*` performance
        // measures; no-op in production). Wraps only the stage calls — the
        // surrounding option assembly is trivial.
        const parsed = measureHere('parse', () =>
          parseStage({
            children: augmented,
            remarkPlugins,
            rehypePlugins,
            remarkRehypeOptions: mergedRemarkRehypeOptions,
          })
        );
        const hastRoot = measureHere('transform', () => transformStage(parsed));
        return { mdast: parsed.mdast, hast: hastRoot };
      }

      try {
        const result = advanceIncrementalParse(incrementalStateRef.current, content ?? '', {
          remarkPlugins,
          rehypePlugins,
          remarkRehypeOptions: mergedRemarkRehypeOptions,
          // Identity tuple over every parse input beyond the content itself.
          // Deliberately covers MORE than the G3 flush's 12 fields (handlers /
          // preserveForBodyHarvest / documentId can change without touching
          // any G3 field — e.g. a `preserveOrphanReferences` flip). The
          // phantom label sets are deliberately NOT here: their churn tracks
          // the suffix (always re-parsed with the tail), never the prefix.
          depsKey: [remarkPlugins, rehypePlugins, remarkRehypeOptions, handlers, preserveForBodyHarvest, documentId],
          defListEnabled,
          phantomSuffix,
          measure: measureHere,
        });
        incrementalStateRef.current = result.nextState;
        return { mdast: result.mdast, hast: result.hast };
      } catch (error) {
        // The engine mutates prev's scan checkpoint IN PLACE before the tail
        // parse/splice — a throw mid-frame (an engine bug, or a plugin
        // choking on the synthetic tail source) leaves the retained state's
        // checkpoint describing content the state's trees do not. Clearing
        // the ref restores the "state is CLEARED when unusable" discipline;
        // the frame then renders via the ordinary full pipeline so one bad
        // frame cannot take the surface down.
        incrementalStateRef.current = null;
        if (process.env.NODE_ENV !== 'production') {
          console.error('[ai-react-markdown] incremental parse failed — full parse fallback for this frame:', error);
        }
        const parsed = measureHere('parse', () =>
          parseStage({
            children: augmented,
            remarkPlugins,
            rehypePlugins,
            remarkRehypeOptions: mergedRemarkRehypeOptions,
          })
        );
        const hastRoot = measureHere('transform', () => transformStage(parsed));
        return { mdast: parsed.mdast, hast: hastRoot };
      }
    }, [
      content,
      targetPhantoms,
      remarkPlugins,
      rehypePlugins,
      remarkRehypeOptions,
      handlers,
      preserveForBodyHarvest,
      documentId,
      incrementalParse,
      defListEnabled,
      measureHere,
    ]);

    // Cut hast into per-block units indexed back to mdast for cache identity,
    // and compute the document-wide ctx digest for cross-block invalidation.
    const built = useMemo(
      () => measureHere('build', () => buildBlocks(pipeline.mdast, pipeline.hast, content ?? '')),
      [pipeline, content, measureHere]
    );

    // Streaming-cursor tail signal: classify whether the source tail sits
    // inside a (footnote / link-reference) definition — derived from the
    // SAME mdast this render draws, with phantom-suffix nodes filtered by
    // offset against the preprocessed content. Only computed while
    // streaming: the marker it drives must not exist in static documents
    // (see the marker's own comment in the render tail). The legacy
    // (blockMemo:false) path has no pipeline mdast and renders no marker —
    // the cursor keeps today's body-tail behavior there.
    const { streaming } = useAIMarkdownState();
    const tailSignal = useMemo(
      () => (streaming ? deriveTailSignal(pipeline.mdast, (content ?? '').length) : null),
      [streaming, pipeline, content]
    );

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
    // → pipeline re-runs (new mdast reference) → this effect would re-fire
    // and re-contribute the same data → loop. Comparing serialized payload
    // to last contribution breaks the cycle at the side-effect layer.
    //
    // Ordering: `sym` is in the dep array, so this effect re-fires after the
    // allocate effect commits its setSym(...). The previous microtask/flushSync
    // dance is gone; React's dep system enforces "allocate before contribute".
    const lastContributionRef = useRef<{
      registry: RegistryInternal;
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
      // Defense in depth for cross-chunk URLs: pass the resolved urlTransform
      // (caller-supplied or default protocol allowlist) into extractContributions
      // so `linkDef.url` enters the registry already sanitized. The render-time
      // gate in `CrossChunkLink` / `CrossChunkImage` (`sanitizeCrossChunkUrl`)
      // is the primary defense and IS per-attribute correct (`'href'` for `<a>`,
      // `'src'` for `<img>`). This contribute-time pass is a coarser belt-and-
      // suspenders layer — it uses the fixed `'href'` key because at contribute
      // time we don't yet know whether a given def will be consumed as a link
      // or an image. Known corner: a key-aware urlTransform that allows a
      // scheme on `src` but NOT on `href` (e.g. a media-only allowlist) will
      // see its cross-chunk images render empty, even though standalone images
      // would have rendered the URL. If you hit this, drop the prop on this
      // call site — render-time is sufficient for security; the entry here is
      // a hygiene-of-registry-contents convenience for any future consumer
      // reading `Registry.resolveLinkDef` directly.
      const resolvedUrlTransform = urlTransform ?? defaultUrlTransform;
      for (const node of extractContributions(pipeline.mdast, {
        phantomFootnoteLabels: targetPhantoms.missingFootnotes,
        urlTransform: resolvedUrlTransform,
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
      lastContributionRef.current = { registry, symbol: sym, fp };
      registry.contributeChunkData(sym, {
        refs,
        defs,
        linkDefs,
        ownFootnoteLabels: ownLabels.footnoteLabels,
        ownLinkLabels: ownLabels.linkLabels,
      });
    }, [pipeline, ownLabels, registry, targetPhantoms, sym, clobberPrefix, urlTransform]);

    // Intentional cache memoization via cacheRef; see G3 comment above.
    // Unlike the three memoized stages above, this runs on EVERY render —
    // its 'render' measures therefore include the cheap all-cache-hit
    // re-renders, which is the honest shape of what block-memo saves.
    const rendered = measureHere('render', () =>
      renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, postOptions)
    );

    // Cross-chunk URL sanitization policy — read by `CrossChunkLink` and
    // `CrossChunkImage` at render time to apply the same two-gate pipeline
    // (urlTransform + protocols allowlist) the standalone in-tree pass
    // applies. Resolved here so the same `defaultUrlTransform` /
    // `sanitizeSchema` fallbacks the rest of the pipeline uses are honored
    // — no chance of drift between standalone and cross-chunk paths.
    const crossChunkUrlPolicy = useMemo<CrossChunkUrlPolicy>(
      () => ({
        urlTransform: urlTransform || defaultUrlTransform,
        sanitizeSchema: usedSanitizeSchema,
      }),
      [urlTransform, usedSanitizeSchema]
    );

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
      <CrossChunkUrlContext.Provider value={crossChunkUrlPolicy}>
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
          {tailSignal ? (
            // Streaming-cursor tail marker: tells the cursor shell (same
            // commit as the content DOM it will measure — no React timing
            // skew) that the source tail is inside a definition, and which
            // footer <li> the text is streaming into. Rendered ONLY while
            // streaming with a definition tail: a permanent marker would
            // re-break the `:last-child` margin-trim fallbacks the SCSS
            // keeps for pre-Baseline-2023 engines (the modern rulesets
            // exclude it explicitly, same as the cursor wrapper). display:
            // none keeps it out of layout; the anchor walk skips it by
            // attribute. Mount/unmount on signal flips doubles as the
            // childList mutation that wakes the shell's observer.
            <span
              data-aimd-tail-kind={tailSignal.kind}
              data-aimd-tail-label={tailSignal.kind === 'footnote-def' ? tailSignal.identifier : undefined}
              data-aimd-clobber-prefix={tailSignal.kind === 'footnote-def' ? clobberPrefix : undefined}
              style={{ display: 'none' }}
            />
          ) : null}
        </ChunkSymbolContext.Provider>
      </CrossChunkUrlContext.Provider>
    );
  }
);
BlockMemoizedRenderer.displayName = 'BlockMemoizedRenderer';

/**
 * Legacy render path. Mounted when the resolved `blockMemo` is `false`.
 * Calls the vendored `<Markdown>` directly — every render runs the full
 * pipeline end-to-end with no cross-frame reuse. Output is byte-identical
 * to the block-memo path in standalone mode (validated by
 * `byteEquivalence.test.tsx`).
 *
 * **Cross-chunk coordination (Phase 11) is NOT wired through this path.**
 * Wrapping `<AIMarkdown>` with `<AIMarkdownDocuments>` while keeping
 * `blockMemo: false` silently runs without coordination — orphan
 * defs are not protected, refs across chunks don't resolve. If you need
 * cross-chunk behavior, keep `blockMemo: true` (the default).
 */
const LegacyRenderer = memo(
  // `sanitizeSchema` is accepted (and ignored) here purely for prop-shape
  // parity with `BlockMemoizedRenderer` — legacy mode skips cross-chunk
  // coordination entirely, so there's no placeholder needing the schema.
  // Rebind to an underscore-prefixed local so the project's
  // no-unused-vars rule (which allows `_`-prefixed names) accepts it.
  ({
    content,
    usedComponents,
    remarkPlugins,
    rehypePlugins,
    remarkRehypeOptions,
    urlTransform,
    sanitizeSchema: _sanitizeSchema,
  }: RendererProps) => (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={remarkRehypeOptions}
      components={usedComponents}
      urlTransform={urlTransform}
    >
      {content}
    </Markdown>
  )
);
LegacyRenderer.displayName = 'LegacyRenderer';

/**
 * Internal component that assembles the remark/rehype plugin chain based on
 * the resolved engine values (received as internal props from
 * `<AIMarkdown>`'s single resolution point), then dispatches to either the
 * block-memo renderer or the legacy renderer based on `blockMemo`.
 */
const AIMarkdownContent = memo(
  ({
    content,
    customComponents,
    urlTransform,
    sanitizeSchema: customSanitizeSchema,
    blockMemo,
    incrementalParse,
    preserveOrphanReferences,
    enginePlugins,
  }: AIMarkdownContentProps) => {
    const { clobberPrefix } = useAIMarkdownDocument();
    // Dev-mode flip probes live in the parent `<AIMarkdown>`'s stability
    // firewall (`useStableRecord`, `./../index.tsx`) — the DEEP_EQUAL policy
    // there both warns on identity churn and restores the previous reference.
    // Don't add a duplicate probe here.
    // Resolve schema: caller-provided override (from `extendSanitizeSchema(...)`
    // or a hand-rolled Schema) wins; otherwise the library default. Reference
    // identity is preserved by the parent's firewall, so this picks one of two
    // stable references rather than minting a new object every render —
    // important for the rehypePlugins memo below.
    const usedSanitizeSchema = customSanitizeSchema ?? sanitizeSchema;

    const enableDefinitionList = enginePlugins.some((plugin) => plugin.name === 'definitionList');

    const usedComponents = useMemo(() => {
      return customComponents ? { ...DefaultCustomComponents, ...customComponents } : DefaultCustomComponents;
    }, [customComponents]);

    // Stable plugin/options arrays so this component's React.memo wrapper can
    // skip re-renders when only the parent re-rendered. The vendored
    // `parseStage` rebuilds the unified processor on every call regardless —
    // there is no internal processor cache to feed.
    // Chain assembly lives in pluginChain.ts — the single source shared with
    // the splice-equivalence arbiter and the prefixFreeze experiment harness,
    // so verification suites can never drift from the shipped order.
    const remarkPlugins = useMemo<RemarkPlugins>(() => buildCoreRemarkPlugins(enginePlugins), [enginePlugins]);

    const rehypePlugins = useMemo<RehypePlugins>(
      () => buildCoreRehypePlugins(usedSanitizeSchema, clobberPrefix),
      [clobberPrefix, usedSanitizeSchema]
    );

    const remarkRehypeOptions = useMemo<RemarkRehypeOptions>(
      () => buildCoreRemarkRehypeOptions(enableDefinitionList),
      [enableDefinitionList]
    );

    const Renderer = blockMemo ? BlockMemoizedRenderer : LegacyRenderer;
    return (
      <Renderer
        content={content}
        usedComponents={usedComponents}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={remarkRehypeOptions}
        urlTransform={urlTransform}
        sanitizeSchema={usedSanitizeSchema}
        incrementalParse={incrementalParse}
        preserveOrphanReferences={preserveOrphanReferences}
        defListEnabled={enableDefinitionList}
      />
    );
  }
);

AIMarkdownContent.displayName = 'AIMarkdownContent';

export default AIMarkdownContent;
