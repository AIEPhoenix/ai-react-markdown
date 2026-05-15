/**
 * Optional outer wrapper enabling cross-chunk coordination for any
 * `<AIMarkdown>` instances rendered as descendants. Each unique
 * `documentId` partitions its own Registry.
 *
 * Without this wrapper, `<AIMarkdown>` instances render independently
 * (current behavior). With it, multiple chunks sharing a `documentId`
 * coordinate footnote numbering, linkReference/imageReference resolution,
 * and anchor jumps across chunks.
 *
 * @module components/AIMarkdownDocuments
 */
import { createContext, useContext, useMemo, useRef, type PropsWithChildren, type FC } from 'react';
import { createRegistry, type Registry, type RegistryInternal } from './documentRegistry';

interface AIMarkdownDocumentsContextValue {
  /** Returns the registry for a given documentId. Holds the internal
   *  (mutator-bearing) shape; {@link useDocumentRegistry} narrows the
   *  return type to the public read-only {@link Registry} surface so
   *  external consumers can't drive the registry directly. Internal
   *  callers (`MarkdownContent`, tests via `__internalGetContext`) keep
   *  the wider view. */
  getRegistry: (documentId: string) => RegistryInternal;
  preserveOrphanReferences: boolean;
}

const AIMarkdownDocumentsContext = createContext<AIMarkdownDocumentsContextValue | null>(null);

export interface AIMarkdownDocumentsProps extends PropsWithChildren {
  /**
   * Default `true`. Unconditionally controls orphan-reference protection
   * for all chunks under this wrapper, overriding their individual
   * `config.preserveOrphanReferences`. Does not control cross-chunk
   * coordination itself (that's gated by wrapper presence + `documentId`).
   */
  preserveOrphanReferences?: boolean;
}

/** Message body for the "nested wrapper" misuse error / warning. Centralised
 *  so dev and prod paths emit the exact same text — easier to grep in user
 *  bug reports. */
const NESTED_WRAPPER_MESSAGE =
  '<AIMarkdownDocuments> must not be nested inside another <AIMarkdownDocuments>. Use a single top-level wrapper per coordinated scope.';

/**
 * The "happy path" implementation: allocates a per-instance registries Map
 * and Provider value. Split out from `AIMarkdownDocuments` so the parent
 * component's pre-hook nesting gate (which may early-return) doesn't put
 * the hooks below behind a conditional — rules-of-hooks is then trivially
 * satisfied because every render of THIS inner component goes through all
 * the hooks in the same order.
 */
const AIMarkdownDocumentsRoot: FC<Required<Pick<AIMarkdownDocumentsProps, 'preserveOrphanReferences'>> & PropsWithChildren> = ({
  preserveOrphanReferences,
  children,
}) => {
  // Registries are persistent across renders. Map<documentId, Registry>.
  //
  // Eviction: each registry receives an `onEmpty` callback that the
  // wrapper invokes when the registry's last chunk just released its
  // Symbol. The callback removes the registry from this Map iff the
  // entry is STILL the one we created — a fresh `getRegistry(documentId)`
  // racing the cleanup microtask would have already replaced it, in
  // which case eviction is a no-op. This keeps the Map bounded by the
  // number of `documentId` values with at least one chunk alive at any
  // given moment.
  //
  // Known edge case (acceptable v1 limitation): `getRegistry` is called
  // synchronously from `useDocumentRegistry` during render, and creates
  // the registry + writes the Map entry as a render-time side effect.
  // React 19's concurrent rendering allows aborting a render before
  // commit; if a render is aborted AFTER `getRegistry(X)` has created a
  // new registry but BEFORE any chunk's allocate effect commits, AND the
  // next render uses a different `documentId`, the aborted render's
  // registry leaks (no chunk ever attaches, so `onEmpty` never fires).
  // The leak is bounded (one empty Registry shell per aborted-render-
  // with-unique-documentId), the shell is small (a few empty Sets and a
  // version counter), and concurrent aborts on documentId-bearing
  // components are rare in practice. A proper fix would defer the Map
  // insert to chunk-subscription time, but that breaks the synchronous-
  // getter contract `useDocumentRegistry` relies on. Deferred.
  const registriesRef = useRef<Map<string, RegistryInternal>>(new Map());

  const value = useMemo<AIMarkdownDocumentsContextValue>(
    () => ({
      preserveOrphanReferences,
      getRegistry(documentId: string) {
        let r = registriesRef.current.get(documentId);
        if (!r) {
          // Capture `r` in the closure so the identity check below
          // compares against the exact registry instance we created.
          // A microtask-delayed onEmpty firing AFTER a subsequent
          // getRegistry replaced the entry must NOT evict the new one.
          const created = createRegistry(() => {
            if (registriesRef.current.get(documentId) === created) {
              registriesRef.current.delete(documentId);
            }
          });
          r = created;
          registriesRef.current.set(documentId, r);
        }
        return r;
      },
    }),
    [preserveOrphanReferences]
  );

  return <AIMarkdownDocumentsContext.Provider value={value}>{children}</AIMarkdownDocumentsContext.Provider>;
};

export const AIMarkdownDocuments: FC<AIMarkdownDocumentsProps> = ({ preserveOrphanReferences = true, children }) => {
  const parent = useContext(AIMarkdownDocumentsContext);
  if (parent !== null) {
    // Dev: fail fast. The error makes the misuse obvious in any non-
    // production environment and prevents subtle bugs (the inner wrapper's
    // children would silently see the outer wrapper's registry / preserve-
    // orphan policy, which is almost never what a nested wrapper was
    // attempting to express).
    //
    // Prod: degrade gracefully. AI chat / document UIs that wire
    // `<AIMarkdownDocuments>` deep inside dynamic composition (RSC, portals,
    // third-party layout libs) can hit the nested-wrapper case via an
    // upstream bug — crashing the entire conversation pane is worse user
    // experience than silently rendering the inner subtree against the outer
    // wrapper. Emit a `console.error` (visible to ops dashboards / Sentry)
    // and render `children` as-is so the existing outer Provider continues
    // to apply.
    //
    // Hooks-rules note: the outer component only calls `useContext` before
    // the early return; the hooks that allocate state (`useRef`, `useMemo`)
    // live in `AIMarkdownDocumentsRoot`, which is only mounted on the
    // non-nested branch. Whichever branch this instance takes, it takes
    // for its entire lifetime — React's per-instance hook order stays
    // stable and ESLint's `react-hooks/rules-of-hooks` is happy.
    //
    // The dev/prod split mirrors React's own invariant-vs-warning pattern.
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(NESTED_WRAPPER_MESSAGE);
    }
    console.error(`[ai-react-markdown] ${NESTED_WRAPPER_MESSAGE} Falling back to the outer wrapper; the inner wrapper is a no-op.`);
    return <>{children}</>;
  }
  return (
    <AIMarkdownDocumentsRoot preserveOrphanReferences={preserveOrphanReferences}>
      {children}
    </AIMarkdownDocumentsRoot>
  );
};

/**
 * Returns the registry for the given `documentId`, or `null` if:
 *  - `<AIMarkdown>` is not inside an `<AIMarkdownDocuments>` wrapper, OR
 *  - `documentId` is undefined / empty string.
 *
 * Callers should treat `null` as "no coordination; run standalone path."
 */
export function useDocumentRegistry(documentId: string | undefined): Registry | null {
  const ctx = useContext(AIMarkdownDocumentsContext);
  if (!ctx || !documentId) return null;
  return ctx.getRegistry(documentId);
}

/** Returns the effective preserveOrphanReferences for this position in the tree:
 *  the wrapper's prop value if inside one, otherwise the supplied fallback
 *  (typically `config.preserveOrphanReferences`). */
export function usePreserveOrphanReferences(fallback: boolean): boolean {
  const ctx = useContext(AIMarkdownDocumentsContext);
  return ctx?.preserveOrphanReferences ?? fallback;
}

/** @internal — for tests only. */
export function __internalGetContext(): AIMarkdownDocumentsContextValue | null {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useContext(AIMarkdownDocumentsContext);
}
