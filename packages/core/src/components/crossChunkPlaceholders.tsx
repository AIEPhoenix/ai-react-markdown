/**
 * Placeholder React components that custom hast tags
 * (`<cross-chunk-link>` / `<cross-chunk-image>` / `<footnote-sup>`)
 * map to via react-markdown's `components` prop.
 *
 * Each subscribes to its document's Registry via useSyncExternalStore.
 * On selector miss (registry not present, label not resolved):
 *   - FootnoteSupNumber renders null
 *   - CrossChunkLink falls back to literal source text by referenceType
 *   - CrossChunkImage falls back to literal source text by referenceType
 *
 * @module components/crossChunkPlaceholders
 */
import { type ReactNode, isValidElement, useCallback, useContext, useSyncExternalStore } from 'react';
import { useAIMarkdownRenderState } from '../context';
import { useDocumentRegistry } from './AIMarkdownDocuments';
import { ChunkSymbolContext } from './chunkSymbolContext';
import type { LinkDef } from './documentRegistry';

type RefType = 'full' | 'collapsed' | 'shortcut' | undefined;

/** Module-level SSR snapshot constant. Hoisted out of components so its
 *  identity is stable across renders. */
const SSR_NUM_SNAPSHOT = () => 0;
const SSR_DEF_SNAPSHOT = () => null;

interface FootnoteSupProps {
  label: string;
  /** Chunk-local occurrence index (1-based) of THIS particular `[^x]`
   *  reference within the chunk's parse. Used together with the per-chunk
   *  Symbol from `ChunkSymbolContext` to compute the cross-chunk *global*
   *  occurrence index, which disambiguates duplicate `id="fnref-X"` when
   *  the same footnote is referenced multiple times. Carried on the hast
   *  tag by `customMdastHandlers.footnoteReference`.
   *
   *  **Type note**: customMdastHandlers emits this as a JS number, but
   *  rehype-raw's parse5 round-trip stringifies it (verified in
   *  `customMdastHandlers.test.ts`). The component accepts either form
   *  and coerces internally so the contract is robust to the pipeline. */
  localOccurrence?: number | string;
  /** Optional — but normally the hast tag carries it. */
  documentId?: string;
}

/** Coerce the on-the-wire `localOccurrence` (which may be a JS number from
 *  the handler OR a stringified attr from rehype-raw's parse5 round-trip)
 *  to a finite positive integer, or null if absent / malformed. */
function coerceLocalOccurrence(v: number | string | undefined): number | null {
  if (v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 1 ? Math.trunc(v) : null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

export function FootnoteSupNumber({ label, localOccurrence: localOccurrenceRaw }: FootnoteSupProps): ReactNode {
  const localOccurrence = coerceLocalOccurrence(localOccurrenceRaw);
  const { documentId, clobberPrefix } = useAIMarkdownRenderState();
  const registry = useDocumentRegistry(documentId);
  const chunkSym = useContext(ChunkSymbolContext);
  // Subscribe identity stabilised across renders (see top of file).
  // useSyncExternalStore's selector must return an `Object.is`-stable value
  // across notifications when the underlying registry state is unchanged —
  // `registry.version` is just a number, so this property holds.
  const subscribe = useCallback((cb: () => void) => (registry ? registry.subscribe(cb) : () => {}), [registry]);
  const getSnapshot = useCallback(() => registry?.version ?? 0, [registry]);
  useSyncExternalStore(subscribe, getSnapshot, SSR_NUM_SNAPSHOT);
  const num = registry?.globalNumber(label) ?? null;
  if (num === null) return null;
  if (localOccurrence !== null && !chunkSym) return null;
  const globalOcc =
    registry && chunkSym && localOccurrence !== null
      ? registry.globalOccurrenceForRef(chunkSym, label, localOccurrence)
      : null;
  if (localOccurrence !== null && globalOcc === null) return null;
  // Append `-N` when this is the 2nd+ occurrence of the same label across
  // the document. The first occurrence keeps the bare `fnref-${id}` so a
  // ref-once-only doc renders byte-identical to the pre-multi-ref design.
  const occSuffix = globalOcc !== null && globalOcc > 1 ? `-${globalOcc}` : '';
  return (
    <sup>
      <a href={`#${clobberPrefix}fn-${label}`} id={`${clobberPrefix}fnref-${label}${occSuffix}`} data-footnote-ref>
        {num}
      </a>
    </sup>
  );
}

interface CrossChunkLinkProps {
  label: string;
  referenceType: RefType;
  children?: ReactNode;
}

/** Recursively flatten a ReactNode tree to plain text. The fallback for
 *  an unresolved CrossChunkLink renders the literal markdown source
 *  (`[text][label]`); the `[text]` slot must therefore be a string, not a
 *  React element tree. Rich children — e.g. `[**bold**][missing]` whose
 *  `[text]` slot mdast lowered to `<strong>bold</strong>` then react-
 *  markdown handed us as `<strong>bold</strong>` React element — would
 *  otherwise stringify as the literal `"[object Object]"` via the previous
 *  `children?.toString?.()` path. Walking the tree and concatenating text
 *  nodes degrades the rich markup to plain text but preserves the human-
 *  readable label slot, which is what the fallback aims for. */
function reactNodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToText).join('');
  if (isValidElement(node)) {
    return reactNodeToText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

function literalLink(rt: RefType, label: string, children: ReactNode): string {
  const text = reactNodeToText(children);
  switch (rt) {
    case 'full':
      return `[${text}][${label}]`;
    case 'collapsed':
      return `[${label}][]`;
    case 'shortcut':
    default:
      return `[${label}]`;
  }
}

export function CrossChunkLink({ label, referenceType, children }: CrossChunkLinkProps): ReactNode {
  const { documentId } = useAIMarkdownRenderState();
  const registry = useDocumentRegistry(documentId);
  const subscribe = useCallback((cb: () => void) => (registry ? registry.subscribe(cb) : () => {}), [registry]);
  const getSnapshot = useCallback(() => registry?.resolveLinkDef(label) ?? null, [registry, label]);
  const def = useSyncExternalStore<LinkDef | null>(subscribe, getSnapshot, SSR_DEF_SNAPSHOT);
  if (!def) {
    return literalLink(referenceType, label, children);
  }
  return (
    <a href={def.url} title={def.title}>
      {children}
    </a>
  );
}

interface CrossChunkImageProps {
  label: string;
  referenceType: RefType;
  alt?: string;
}

function literalImage(rt: RefType, label: string, alt: string): string {
  switch (rt) {
    case 'full':
      return `![${alt}][${label}]`;
    case 'collapsed':
      return `![${alt}][]`;
    case 'shortcut':
    default:
      return `![${label}]`;
  }
}

export function CrossChunkImage({ label, referenceType, alt = '' }: CrossChunkImageProps): ReactNode {
  const { documentId } = useAIMarkdownRenderState();
  const registry = useDocumentRegistry(documentId);
  const subscribe = useCallback((cb: () => void) => (registry ? registry.subscribe(cb) : () => {}), [registry]);
  const getSnapshot = useCallback(() => registry?.resolveLinkDef(label) ?? null, [registry, label]);
  const def = useSyncExternalStore<LinkDef | null>(subscribe, getSnapshot, SSR_DEF_SNAPSHOT);
  if (!def) {
    return literalImage(referenceType, label, alt);
  }
  return <img src={def.url} alt={alt} title={def.title} />;
}

/**
 * Components map suitable for spreading into react-markdown's `components` prop.
 * Keys are lowercase tag names matching the custom hast tags emitted by
 * Phase 6 handlers.
 */
export const crossChunkComponents = {
  'footnote-sup': FootnoteSupNumber,
  'cross-chunk-link': CrossChunkLink,
  'cross-chunk-image': CrossChunkImage,
};
