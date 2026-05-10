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
import { createRegistry, type Registry } from './documentRegistry';

interface AIMarkdownDocumentsContextValue {
  getRegistry: (documentId: string) => Registry;
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

export const AIMarkdownDocuments: FC<AIMarkdownDocumentsProps> = ({ preserveOrphanReferences = true, children }) => {
  const parent = useContext(AIMarkdownDocumentsContext);
  if (parent !== null) {
    throw new Error(
      '<AIMarkdownDocuments> must not be nested inside another <AIMarkdownDocuments>. Use a single top-level wrapper per coordinated scope.'
    );
  }

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
  const registriesRef = useRef<Map<string, Registry>>(new Map());

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
