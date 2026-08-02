/**
 * The AIMarkdown context layer: five per-system contexts (document, metadata,
 * state, theme, behaviors), five narrow hooks, the aggregate hook, and the
 * two additive Providers. `AIMarkdownProvider` receives already-resolved
 * values from `<AIMarkdown>` — resolution happens exactly once, in the
 * component (see `resolveFlatProps.ts`).
 *
 * @module context
 */

import { PropsWithChildren, createContext, useContext, useId, useMemo, useRef, type Context, type FC } from 'react';
import { AIMarkdownMetadata, AIMarkdownVariant, AIMarkdownColorScheme } from './defs';
import { shortenDocumentId } from './components/shortenDocumentId';

const AIMarkdownMetadataContext = createContext<AIMarkdownMetadata | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// The context layer (EXECUTION-PLAN §3.4): five contexts, five narrow
// hooks, one aggregate hook, two additive Providers.
// ─────────────────────────────────────────────────────────────────────────────

/** Module-scope dev flag — resolved at build time (see `useReferenceFlipWarning`'s docblock). */
const __DEV__ = process.env.NODE_ENV !== 'production';

/** Payload of the document context — entirely derived invariants (closed to extension). */
export interface AIMarkdownDocumentInfo {
  /** Resolved logical-document id (consumer-supplied or `useId()` fallback). */
  documentId: string;
  /** Whether `documentId` was explicitly supplied — the cross-chunk coordination signal. */
  documentIdExplicit: boolean;
  /** Canonical URI-safe id prefix for clobberable attributes; never reconstruct locally. */
  clobberPrefix: string;
}

/** Payload of the theme context (value tier of the Theme system). */
export interface AIMarkdownThemeInfo {
  /** Resolved CSS font-size value (number props already normalized to `px`). */
  fontSize: string;
  variant: AIMarkdownVariant;
  colorScheme: AIMarkdownColorScheme;
}

/** Core (locked) keys of the state context. */
export interface AIMarkdownStateCore {
  streaming: boolean;
}

/** Core (locked) keys of the behaviors context — the three engine switches. */
export interface AIMarkdownBehaviorsCore {
  /** Output-invariant engine strategy: block-level memoization. */
  blockMemo: boolean;
  /** Output-invariant engine strategy: incremental (prefix-freeze) parsing. */
  incrementalParse: boolean;
  /** Orphan-reference policy for incomplete/streaming documents (affects output). */
  preserveOrphanReferences: boolean;
}

/**
 * Extension groups accepted by {@link AIMarkdownStateProvider}. Core keys are
 * type-forbidden (`never`) — they are owned by `<AIMarkdown>`'s resolution
 * and would be overwritten at the innermost merge anyway.
 *
 * **Frequency contract**: group members must change at message-lifecycle
 * frequency (aborted, reasoning, tool-call-in-progress, …). Frame-rate data
 * (per-token progress etc.) goes through metadata's stable-container
 * pattern instead — one context, every subscriber re-renders per change.
 */
export type AIMarkdownStateGroups = { [group: string]: object } & { streaming?: never };

/**
 * Extension groups accepted by {@link AIMarkdownBehaviorsProvider} —
 * wrapper component-behavior parameter groups (e.g. mantine's `codeBlock`).
 * Core keys are type-forbidden (`never`).
 */
export type AIMarkdownBehaviorGroups = { [group: string]: object } & {
  blockMemo?: never;
  incrementalParse?: never;
  preserveOrphanReferences?: never;
};

/**
 * Opaque extension-group record seen by consumers. Values are typed
 * `object | undefined` so a mistyped group key does not type as present;
 * wrapper narrow hooks perform the single type assertion.
 */
export type AIMarkdownExtensionGroups = Record<string, object | undefined>;

/**
 * Internal additive-context factory shared by the state and behaviors
 * cells (the factory itself is NOT exported — only the two named Providers
 * are public API).
 *
 * Transport model: a wrapper or application stacks its groups *outside*
 * `<AIMarkdown>` via the public `Provider`; core's innermost `CoreProvider`
 * reads the outer same-named context and provides
 * `{ ...outer, ...coreResolved }` downward, so consumers see exactly one
 * context. Multi-level wrappers stack naturally — the public Provider also
 * merges its own outer context, and for a duplicated group key the inner
 * layer wins.
 *
 * Three locks keep outer layers off the core keys (otherwise hook reads
 * would diverge from actual behavior):
 * 1. Type level — the group types forbid core keys with `never`.
 * 2. Runtime — `CoreProvider` spreads the core-resolved values LAST, so
 *    they unconditionally overwrite anything an outer layer carried.
 * 3. Dev — the public Provider warns when its value carries a core key.
 *
 * Known cost (accepted): within one context, group invalidation is not
 * isolated — one group change leaf-re-renders all subscribers of that
 * context. A party needing isolation may run a private context instead.
 */
function createAdditiveContext<TCore extends object, TGroups extends object>(
  coreKeys: readonly string[],
  providerName: string
): {
  Ctx: Context<(TCore & AIMarkdownExtensionGroups) | null>;
  Provider: FC<PropsWithChildren<{ value: TGroups }>>;
  CoreProvider: FC<PropsWithChildren<{ coreValue: TCore }>>;
} {
  const Ctx = createContext<(TCore & AIMarkdownExtensionGroups) | null>(null);

  const Provider: FC<PropsWithChildren<{ value: TGroups }>> = ({ value, children }) => {
    const outer = useContext(Ctx);
    // Warn once per provider instance — core-key misuse is a static coding
    // error, not a per-render condition worth spamming about. State lives as
    // a property of a lazily-initialized ref object (same discipline as
    // `useReferenceFlipWarning`'s FlipState).
    const warnStateRef = useRef<{ warned: boolean } | null>(null);
    const warnState = (warnStateRef.current ??= { warned: false });
    if (__DEV__ && !warnState.warned) {
      for (const key of coreKeys) {
        if (key in (value as Record<string, unknown>)) {
          warnState.warned = true;
          console.warn(
            `[AIMarkdown] <${providerName}> received the core key \`${key}\` in its value. ` +
              `Core keys are resolved by <AIMarkdown> itself and unconditionally overwrite ` +
              `outer values — remove the key from the provider value.`
          );
        }
      }
    }
    const merged = useMemo(
      () => Object.freeze({ ...outer, ...value }) as TCore & AIMarkdownExtensionGroups,
      [outer, value]
    );
    return <Ctx.Provider value={merged}>{children}</Ctx.Provider>;
  };
  Provider.displayName = providerName;

  /**
   * Internal innermost provider rendered by `AIMarkdownProvider`.
   * Merge is memoized on `[outer, coreValue]` so the context value keeps a
   * stable identity across unrelated re-renders; core values spread LAST
   * (runtime lock #2).
   */
  const CoreProvider: FC<PropsWithChildren<{ coreValue: TCore }>> = ({ coreValue, children }) => {
    const outer = useContext(Ctx);
    const merged = useMemo(
      () => Object.freeze({ ...outer, ...coreValue }) as TCore & AIMarkdownExtensionGroups,
      [outer, coreValue]
    );
    return <Ctx.Provider value={merged}>{children}</Ctx.Provider>;
  };
  CoreProvider.displayName = `${providerName}.Core`;

  return { Ctx, Provider, CoreProvider };
}

const documentCell = createContext<AIMarkdownDocumentInfo | null>(null);
const themeCell = createContext<AIMarkdownThemeInfo | null>(null);
const stateCell = createAdditiveContext<AIMarkdownStateCore, AIMarkdownStateGroups>(
  ['streaming'],
  'AIMarkdownStateProvider'
);
const behaviorsCell = createAdditiveContext<AIMarkdownBehaviorsCore, AIMarkdownBehaviorGroups>(
  ['blockMemo', 'incrementalParse', 'preserveOrphanReferences'],
  'AIMarkdownBehaviorsProvider'
);

/**
 * Additive (stackable) Provider for state extension groups. Stack it
 * *outside* `<AIMarkdown>`; the value should be firewall output (or any
 * reference-stable record) used directly:
 *
 * ```tsx
 * <AIMarkdownStateProvider value={lifecycleGroups}>
 *   <AIMarkdown … />
 * </AIMarkdownStateProvider>
 * ```
 *
 * Group members obey the message-lifecycle frequency contract — see
 * {@link AIMarkdownStateGroups}. `streaming` is core-locked.
 */
export const AIMarkdownStateProvider = stateCell.Provider;

/**
 * Additive (stackable) Provider for behavior extension groups (wrapper
 * component parameters, e.g. mantine's `codeBlock`). Stack it *outside*
 * `<AIMarkdown>`. The three core switches are core-locked; group defaults
 * are applied inside the wrapper's narrow hook, never at read sites.
 */
export const AIMarkdownBehaviorsProvider = behaviorsCell.Provider;

/** Shared throw-guard for narrow hooks. */
function requireContext<T>(value: T | null, hookName: string): T {
  if (value == null) {
    throw new Error(`${hookName} must be used within an <AIMarkdown /> component.`);
  }
  return value;
}

/**
 * Document-system narrow hook: resolved `documentId`, the
 * `documentIdExplicit` coordination signal, and the canonical
 * `clobberPrefix`. Payload is derived invariants — this context is closed
 * to extension (a forgeable `clobberPrefix` would break the anchor system).
 */
export function useAIMarkdownDocument(): AIMarkdownDocumentInfo {
  return requireContext(useContext(documentCell), 'useAIMarkdownDocument');
}

/** Theme-system narrow hook: `fontSize`, `variant`, `colorScheme`. */
export function useAIMarkdownTheme(): AIMarkdownThemeInfo {
  return requireContext(useContext(themeCell), 'useAIMarkdownTheme');
}

/**
 * State-system narrow hook. `streaming` is the most frequently flipping
 * field in the library — this hook's subscribers are the ONLY components
 * that re-render on a flip (after M4 removes the legacy context).
 * Extension state groups contributed via {@link AIMarkdownStateProvider}
 * appear as additional keys, typed `object | undefined`.
 */
export function useAIMarkdownState(): AIMarkdownStateCore & AIMarkdownExtensionGroups {
  return requireContext(useContext(stateCell.Ctx), 'useAIMarkdownState');
}

/**
 * Behaviors-system narrow hook: the three core engine switches plus an
 * opaque extension record. Non-generic by design — the caller-asserted
 * `TConfig` generic is retired; wrapper narrow hooks (e.g.
 * `useMantineCodeBlockOptions()`) perform the single type assertion and
 * apply group defaults inside.
 */
export function useAIMarkdownBehaviors(): AIMarkdownBehaviorsCore & AIMarkdownExtensionGroups {
  return requireContext(useContext(behaviorsCell.Ctx), 'useAIMarkdownBehaviors');
}

/** Aggregate payload returned by {@link useAIMarkdown}. */
export interface AIMarkdownAggregate<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata> {
  document: AIMarkdownDocumentInfo;
  metadata: TMetadata | undefined;
  state: AIMarkdownStateCore & AIMarkdownExtensionGroups;
  theme: AIMarkdownThemeInfo;
  behaviors: AIMarkdownBehaviorsCore & AIMarkdownExtensionGroups;
}

/**
 * Aggregate hook over all five systems:
 *
 * ```ts
 * const { document, metadata, state, theme, behaviors } = useAIMarkdown();
 * ```
 *
 * **Price**: subscribes to all five contexts and re-renders on ANY change
 * (including every `streaming` flip). Performance-sensitive components
 * should use the narrow hooks; the aggregate serves teaching and
 * low-frequency components.
 */
export function useAIMarkdown<
  TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata,
>(): AIMarkdownAggregate<TMetadata> {
  const document = useAIMarkdownDocument();
  const metadata = useAIMarkdownMetadata<TMetadata>();
  const state = useAIMarkdownState();
  const theme = useAIMarkdownTheme();
  const behaviors = useAIMarkdownBehaviors();
  return useMemo(
    () => ({ document, metadata, state, theme, behaviors }),
    [document, metadata, state, theme, behaviors]
  );
}

/**
 * Access the current metadata from within the `<AIMarkdown>` tree.
 *
 * Metadata lives in its own React context so that changes to metadata do
 * not cause re-renders in components that only consume the other systems
 * (e.g. the internal `MarkdownContent` renderer).
 *
 * ### `TMetadata` is a caller-asserted type
 *
 * The generic is an assertion about the `metadata` prop passed to the
 * provider above, not a value TypeScript can derive. Metadata has no
 * runtime fallback: if the provider received no `metadata`, the hook returns
 * `undefined` regardless of the asserted type. Prefer wrapping this hook in
 * a project-local hook that pins `TMetadata` next to the call site that
 * actually provides the metadata.
 *
 * @typeParam TMetadata - Caller-asserted metadata shape (defaults to
 *   {@link AIMarkdownMetadata}). Caller is responsible for ensuring the
 *   provider's `metadata` prop matches this shape.
 * @returns The current metadata, or `undefined` if none was provided.
 *
 * @see `@ai-react-markdown/mantine` — `useMantineAIMarkdownMetadata` applies
 *   the wrapper pattern to this hook, pinning `MantineAIMarkdownMetadata` in
 *   a single location.
 */
export function useAIMarkdownMetadata<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>() {
  // `as` is intentional: TMetadata is a caller assertion (see JSDoc).
  return useContext(AIMarkdownMetadataContext) as TMetadata | undefined;
}

/** Props for {@link AIMarkdownProvider}. All values arrive already resolved. */
export interface AIMarkdownProviderProps extends PropsWithChildren {
  streaming: boolean;
  fontSize: string;
  variant: AIMarkdownVariant;
  colorScheme: AIMarkdownColorScheme;
  /**
   * Logical-document identifier used as the id namespace for clobberable
   * attributes (id / hash hrefs). Optional — when omitted, the provider
   * auto-generates one via {@link useId} so the provider stays drop-in
   * usable for direct consumers (e.g. extension packages that don't go
   * through `<AIMarkdown>`).
   *
   * Pass the SAME value to multiple providers / `<AIMarkdown>` instances
   * when they render chunks of the same logical document — their id
   * prefixes will align so cross-chunk anchors and (once the parser sees
   * the full doc) footnote navigation work.
   */
  documentId?: string;
  /** Resolved behaviors switch; defaults to the shipped default for direct-provider consumers. */
  blockMemo?: boolean;
  /** Resolved behaviors switch; defaults to the shipped default for direct-provider consumers. */
  incrementalParse?: boolean;
  /** Resolved behaviors switch; defaults to the shipped default for direct-provider consumers. */
  preserveOrphanReferences?: boolean;
}

/** Props for {@link AIMarkdownMetadataProvider}. */
export interface AIMarkdownMetadataProviderProps<
  TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata,
> extends PropsWithChildren {
  metadata?: TMetadata;
}

/**
 * Provider that exposes consumer-provided metadata via a dedicated React context.
 * Separated from render state so that metadata changes do not trigger
 * re-renders in components that only consume render state.
 */
export const AIMarkdownMetadataProvider = <RDT extends AIMarkdownMetadata = AIMarkdownMetadata>({
  metadata,
  children,
}: AIMarkdownMetadataProviderProps<RDT>) => {
  return <AIMarkdownMetadataContext.Provider value={metadata}>{children}</AIMarkdownMetadataContext.Provider>;
};

/**
 * Internal provider that feeds the five per-system contexts from the
 * already-resolved values `<AIMarkdown>` passes in (single resolution
 * point). Directly composable by extension packages that bypass
 * `<AIMarkdown>`; the behaviors switches then default to the shipped
 * defaults.
 */
const AIMarkdownProvider = ({
  streaming,
  fontSize,
  variant,
  colorScheme,
  documentId,
  blockMemo = true,
  incrementalParse = true,
  preserveOrphanReferences = true,
  children,
}: AIMarkdownProviderProps) => {
  // Fallback id when the caller did not supply one. `useId()` is SSR-safe
  // and stable per component instance. We expose its raw value; HTML/URI
  // safety is applied at the `clobberPrefix` derivation below.
  //
  // This provider is the SINGLE descent point for documentId resolution:
  // `<AIMarkdown>` forwards the raw (possibly undefined) prop straight here
  // rather than pre-defaulting it, so the "did the consumer supply an id?"
  // signal survives all the way to where it's consumed. Any deeper consumer
  // that composes this provider directly (e.g. an extension package that
  // bypasses `<AIMarkdown>`) therefore gets identical resolution + the
  // correct `documentIdExplicit` for free.
  const fallbackId = useId();
  const documentIdExplicit = !!(documentId && documentId.length > 0);
  const resolvedDocumentId = documentIdExplicit ? documentId! : fallbackId;

  // URI-fragment safe per-document prefix derived ONCE here so downstream
  // consumers (MarkdownContent, cross-chunk placeholder components, and the
  // document context) read from one canonical source.
  // `encodeURIComponent` runs at the prefix construction site, not at the
  // documentId storage site, so consumers accessing `documentId` directly
  // still see the raw React-native value (e.g. `useId()`'s `_r_0_`) while
  // id="..."/href="#..." bytes are safe.
  //
  // `shortenDocumentId` is applied here (NOT at the documentId storage
  // site) for the same reason: consumer-supplied UUIDs and nanoids
  // shouldn't bloat every rendered `id="…"`. Registry keying — which
  // reads the raw `documentId` — stays on the raw value, so the
  // shortening is a pure HTML-output concern and the `useDocumentRegistry`
  // API surface is unaffected. Pure function ⇒ all chunks sharing one
  // logical documentId still produce identical prefixes.
  const clobberPrefix = `${encodeURIComponent(shortenDocumentId(resolvedDocumentId))}-user-content-`;

  const documentInfo = useMemo<AIMarkdownDocumentInfo>(
    () => Object.freeze({ documentId: resolvedDocumentId, documentIdExplicit, clobberPrefix }),
    [resolvedDocumentId, documentIdExplicit, clobberPrefix]
  );
  const themeInfo = useMemo<AIMarkdownThemeInfo>(
    () => Object.freeze({ fontSize, variant, colorScheme }),
    [fontSize, variant, colorScheme]
  );
  const stateCore = useMemo<AIMarkdownStateCore>(() => Object.freeze({ streaming }), [streaming]);
  const behaviorsCore = useMemo<AIMarkdownBehaviorsCore>(
    () => Object.freeze({ blockMemo, incrementalParse, preserveOrphanReferences }),
    [blockMemo, incrementalParse, preserveOrphanReferences]
  );

  return (
    <documentCell.Provider value={documentInfo}>
      <themeCell.Provider value={themeInfo}>
        <stateCell.CoreProvider coreValue={stateCore}>
          <behaviorsCell.CoreProvider coreValue={behaviorsCore}>{children}</behaviorsCell.CoreProvider>
        </stateCell.CoreProvider>
      </themeCell.Provider>
    </documentCell.Provider>
  );
};

export default AIMarkdownProvider;
