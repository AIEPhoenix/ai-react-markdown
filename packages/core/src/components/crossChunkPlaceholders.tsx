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
import {
  type ReactNode,
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react';
import { useAIMarkdownDocument } from '../context';
import { useDocumentRegistry } from './AIMarkdownDocuments';
import { ChunkSymbolContext } from './chunkSymbolContext';
import { CrossChunkUrlContext } from './crossChunkUrlContext';
import { resolveCrossChunkReference } from '@ai-react-markdown/engine';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { jsx, jsxs } from 'react/jsx-runtime';
import type { CrossChunkUrlPolicy } from './crossChunkUrlContext';
import { defaultUrlTransform } from './markdown';
import { sanitizeSchema as defaultSanitizeSchema } from '@ai-react-markdown/engine';
import type { Element } from 'hast';
import type { LinkDef } from '@ai-react-markdown/engine';
import { footnoteSafeId } from '@ai-react-markdown/engine';

type RefType = 'full' | 'collapsed' | 'shortcut' | undefined;

/** Module-level SSR snapshot constant. Hoisted out of components so its
 *  identity is stable across renders. */
const SSR_LABEL_SNAPSHOT = () => '';

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
  /** The number a standalone render would give this reference (its
   *  footnoteOrder position) — the fallback while the registry has no
   *  global number yet: server render and the client's first frame, where
   *  the chunk's LOCAL synthetic footer is what renders, so mark and footer
   *  agree. Absent on phantom (cross-chunk) refs. */
  localNumber?: number | string;
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

export function FootnoteSupNumber({
  label,
  localOccurrence: localOccurrenceRaw,
  localNumber: localNumberRaw,
}: FootnoteSupProps): ReactNode {
  const localOccurrence = coerceLocalOccurrence(localOccurrenceRaw);
  const localNumber = coerceLocalOccurrence(localNumberRaw);
  const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
  // Thread `documentIdExplicit` exactly like `MarkdownContent` does: a chunk
  // with an auto-generated id must NOT open a registry even if a raw/crafted
  // placeholder tag for it survives into hast inside <AIMarkdownDocuments>.
  // Without this, such a tag would create an orphan registry shell that has
  // no paired registerChunk, so eviction never fires — a leak on the path
  // this whole change exists to keep standalone.
  const registry = useDocumentRegistry(documentId, documentIdExplicit);
  const chunkSym = useContext(ChunkSymbolContext);
  // Select only facts that affect this mark. Unrelated registry updates
  // still notify the store but no longer schedule a React render here.
  const subscribe = useCallback((cb: () => void) => (registry ? registry.subscribe(cb) : () => {}), [registry]);
  const getSnapshot = useCallback(
    () =>
      JSON.stringify([
        registry?.globalNumber(label) ?? null,
        registry && chunkSym && localOccurrence !== null
          ? registry.globalOccurrenceForRef(chunkSym, label, localOccurrence)
          : null,
      ]),
    [registry, label, chunkSym, localOccurrence]
  );
  useSyncExternalStore(subscribe, getSnapshot, SSR_LABEL_SNAPSHOT);
  const num = registry?.globalNumber(label) ?? null;
  // Same id encoding as mdast-util-to-hast's marks and footer (and the
  // aggregate footer): a raw label in the id broke `[^注]` / `[^a%b]`
  // anchors — mark and <li> disagreed (v2.4.0 review).
  const safeId = footnoteSafeId(label);
  // Global occurrence of THIS mark (`-N` for the 2nd+ ref of the label
  // across the document). Null while this chunk has not contributed yet.
  const globalOcc =
    registry && chunkSym && localOccurrence !== null && num !== null
      ? registry.globalOccurrenceForRef(chunkSym, label, localOccurrence)
      : null;
  // (`chunkSym === null` with a numbered label falls through to the id-less
  //  mark below — see the note there.)
  if (num === null) {
    // No global number yet — server render, or the client's first frame
    // before the contribute effect. Render the STANDALONE mark (local
    // number, `-N` by local occurrence) so it lines up with the local
    // synthetic footer that renders in exactly this state; the global
    // numbering takes over once the registry knows the label. Rendering
    // null here left coordinated SSR with footers but no marks
    // (2026-08 project review, core-render-02). Phantom refs (no local
    // number) still render nothing — their def is in another chunk.
    if (localNumber === null) return null;
    const localSuffix = localOccurrence !== null && localOccurrence > 1 ? `-${localOccurrence}` : '';
    // Byte-for-byte the mark mdast-util-to-hast emits (attribute set and
    // order included, id encoding via footnoteSafeId), so a wrapped chunk's
    // server output equals its standalone output — pinned in
    // byteEquivalence.test.tsx.
    return (
      <sup>
        <a
          href={`#${clobberPrefix}fn-${safeId}`}
          id={`${clobberPrefix}fnref-${safeId}${localSuffix}`}
          data-footnote-ref=""
          aria-describedby={`${clobberPrefix}footnote-label`}
        >
          {localNumber}
        </a>
      </sup>
    );
  }
  // No chunk symbol yet (`chunkSym` is state, null on a chunk's very first
  // frame) while the label is already numbered by another chunk: same
  // "known number, unregistered occurrence" transient as below — show the
  // number, no id (r2 P3 carry-over of the 2.4.5 fix; it used to render
  // nothing, and SSR shipped a footer backref pointing at no anchor).
  // Append `-N` when this is the 2nd+ occurrence of the same label across
  // the document. The first occurrence keeps the bare `fnref-${id}` so a
  // ref-once-only doc renders byte-identical to the pre-multi-ref design.
  //
  // `globalOcc === null` with `num` known: the label is numbered but THIS
  // occurrence is not in the registry — transiently (a later-mounted chunk
  // repeating the label, contribute effect pending) or permanently (a ref
  // inside a footnote DEFINITION body: the engine's per-chunk counter bumps
  // it, but contributions skip definition bodies). Both used to render
  // nothing (2026-08-19 review P3, oracle F2). The number is right either
  // way — show it, WITHOUT an id: the registry does not know this ref, so
  // no footer backref will ever point at it, and a chunk-local id would
  // collide with another chunk's real `fnref-<label>` mark (oracle re-check).
  const occSuffix = globalOcc !== null && globalOcc > 1 ? `-${globalOcc}` : '';
  const markId =
    globalOcc !== null || localOccurrence === null ? `${clobberPrefix}fnref-${safeId}${occSuffix}` : undefined;
  return (
    <sup>
      <a href={`#${clobberPrefix}fn-${safeId}`} id={markId} data-footnote-ref="">
        {num}
      </a>
    </sup>
  );
}

/** Convert sanitized HAST properties with the same JSX runtime as regular
 * elements (including required/class/style attributes from custom schemas).
 * Link children are already rendered; retain their component identities. */
function renderResolvedReference(
  input: Parameters<typeof resolveCrossChunkReference>[0],
  policy: CrossChunkUrlPolicy | null,
  clobberPrefix: string,
  children?: ReactNode
): ReactNode {
  const result = resolveCrossChunkReference(
    input,
    policy?.sanitizeSchema ?? defaultSanitizeSchema,
    policy?.urlTransform ?? defaultUrlTransform,
    clobberPrefix
  );
  if (!result.element) return result.keepChildren ? children : null;
  const rendered = toJsxRuntime(result.element, { Fragment, jsx, jsxs });
  return input.tagName === 'a' && isValidElement(rendered) ? cloneElement(rendered, undefined, children) : rendered;
}

interface CrossChunkLinkProps {
  node?: Element;
  label: string;
  identifier?: string;
  referenceType: RefType;
  children?: ReactNode;
  /** The chunk's OWN definition (never a phantom's) — carried by the
   *  handler so the link renders before the registry has it (server render,
   *  first client frame). Runs through the same URL gates as a registry
   *  value; a cross-chunk (canonical) def replaces it once the registry
   *  resolves. See core-render-02. */
  localUrl?: string;
  localTitle?: string;
}

/** The registry's canonical def, or the chunk's own as a fallback. */
function resolveDef(
  registry: { resolveLinkDef(label: string): LinkDef | null } | null,
  label: string,
  localUrl?: string,
  localTitle?: string
): LinkDef | null {
  const canonical = registry?.resolveLinkDef(label) ?? null;
  if (canonical) return canonical;
  if (typeof localUrl === 'string') return { identifier: label, url: localUrl, title: localTitle };
  return null;
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

export function CrossChunkLink({
  node,
  label,
  identifier,
  referenceType,
  children,
  localUrl,
  localTitle,
}: CrossChunkLinkProps): ReactNode {
  const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
  // See FootnoteSupNumber: gate on explicitness so an auto-id chunk never
  // opens a registry shell via a stray placeholder tag.
  const registry = useDocumentRegistry(documentId, documentIdExplicit);
  const policy = useContext(CrossChunkUrlContext);
  // Only a changed destination/title schedules this placeholder. The store
  // still broadcasts notifications; indexing makes each snapshot lookup cheap.
  const subscribe = useCallback((cb: () => void) => (registry ? registry.subscribe(cb) : () => {}), [registry]);
  const getSnapshot = useCallback(() => {
    const def = registry?.resolveLinkDef(identifier ?? label);
    return JSON.stringify(def ? [def.url, def.title ?? null] : null);
  }, [registry, identifier, label]);
  useSyncExternalStore(subscribe, getSnapshot, SSR_LABEL_SNAPSHOT);
  const def = resolveDef(registry, identifier ?? label, localUrl, localTitle);
  if (!def) {
    return literalLink(referenceType, label, children);
  }
  return renderResolvedReference(
    { tagName: 'a', url: def.url, title: def.title, node },
    policy,
    clobberPrefix,
    children
  );
}

interface CrossChunkImageProps {
  node?: Element;
  label: string;
  identifier?: string;
  referenceType: RefType;
  alt?: string;
  /** See CrossChunkLinkProps. */
  localUrl?: string;
  localTitle?: string;
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

export function CrossChunkImage({
  node,
  label,
  identifier,
  referenceType,
  alt = '',
  localUrl,
  localTitle,
}: CrossChunkImageProps): ReactNode {
  const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
  // See FootnoteSupNumber: gate on explicitness so an auto-id chunk never
  // opens a registry shell via a stray placeholder tag.
  const registry = useDocumentRegistry(documentId, documentIdExplicit);
  const policy = useContext(CrossChunkUrlContext);
  // Same subscription-only useSyncExternalStore pattern as CrossChunkLink —
  // see that component for the rationale.
  const subscribe = useCallback((cb: () => void) => (registry ? registry.subscribe(cb) : () => {}), [registry]);
  const getSnapshot = useCallback(() => {
    const def = registry?.resolveLinkDef(identifier ?? label);
    return JSON.stringify(def ? [def.url, def.title ?? null] : null);
  }, [registry, identifier, label]);
  useSyncExternalStore(subscribe, getSnapshot, SSR_LABEL_SNAPSHOT);
  const def = resolveDef(registry, identifier ?? label, localUrl, localTitle);
  if (!def) {
    return literalImage(referenceType, label, alt);
  }
  return renderResolvedReference({ tagName: 'img', url: def.url, title: def.title, alt, node }, policy, clobberPrefix);
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
