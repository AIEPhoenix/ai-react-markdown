/**
 * Custom mdast-util-to-hast handlers for cross-chunk label resolution.
 *
 * Direction A: `footnoteDefinitionHandler` mutates `state.footnoteOrder` (and
 * seeds `state.footnoteCounts` to 0) so `state.footer()` emits a
 * `<section data-footnotes>` even when no `footnoteReference` exists locally
 * (orphan-def protection), without the default reference handler
 * double-registering ids whose definition precedes their first reference.
 *
 * Direction B: `linkReferenceHandler` / `imageReferenceHandler` /
 * `footnoteReferenceHandler` short-circuit the default to-hast output and
 * emit custom hast tags (`cross-chunk-link` / `cross-chunk-image` /
 * `footnote-sup`) carrying `label` + `referenceType` properties. These tags
 * map to React placeholder components in Phase 11. The sentinel URL is never
 * read — the handlers only need to know that the def is resolvable
 * (i.e. present in state.definitionById).
 *
 * All identifier comparisons normalize via {@link normalizeId} to match
 * mdast-util-to-hast's internal uppercase keying convention.
 *
 * @module components/customMdastHandlers
 */
import type { Handlers } from 'mdast-util-to-hast';
import type { LinkReference, ImageReference, FootnoteReference, FootnoteDefinition } from 'mdast';
import type { Element as HastElement } from 'hast';
import { normalizeId } from './normalizeId';

export interface CrossChunkHandlerOptions {
  /** Set of labels (already normalized) that this chunk phantom-injected
   *  into its source for parser acceptance. Handlers use this to short-circuit
   *  state writes that would otherwise leak sentinel content into the footer. */
  phantomFootnoteLabels: Set<string>;
  /** Same role for link/image defs. */
  phantomLinkLabels: Set<string>;
  /** When true, footnoteDefinitionHandler proactively registers orphan defs
   *  to state.footnoteOrder (Direction A). */
  preserveOrphan: boolean;
  /** Passed through to placeholder hast properties so React components can
   *  partition by document. */
  documentId: string;
}

// Type assertion helper for state shape (mdast-util-to-hast doesn't export it).
interface StateShape {
  options: CrossChunkHandlerOptions & Record<string, unknown>;
  footnoteOrder: string[];
  footnoteCounts: Map<string, number>;
  definitionById: Map<string, unknown>;
  all: (node: unknown) => unknown[];
}

export function buildCrossChunkHandlers(): Handlers {
  return {
    footnoteDefinition: (state: unknown, node: FootnoteDefinition): undefined => {
      const s = state as StateShape;
      const id = normalizeId(node.identifier);
      // Phantom def → noop: do not register, do not emit. Footer will skip it
      // because footnoteOrder does not contain id (unless a real ref pushed it).
      if (s.options.phantomFootnoteLabels.has(id)) {
        return undefined;
      }
      // Direction A: orphan def protection. Register so state.footer() emits <li>.
      if (s.options.preserveOrphan && !s.footnoteOrder.includes(id)) {
        s.footnoteOrder.push(id);
        // Seed the ref-counter to 0 alongside the push. In standalone mode
        // only THIS handler is installed, so `footnoteReference` falls back to
        // mdast-util-to-hast's default — and that handler decides "is this id
        // already registered?" by looking at footnoteCounts, not at
        // footnoteOrder. Without the seed, a definition that appears ABOVE its
        // first reference gets pushed here and then pushed AGAIN by the
        // default handler: duplicate <li> with colliding DOM ids, and a sup
        // marker numbered by array length instead of position.
        //
        // Seed 0, not 1: at >= 1 state.footer() emits a backref pointing at a
        // fnref anchor that does not exist for a pure orphan; at 0 the
        // backref loop never runs, so pure-orphan output stays byte-identical
        // and the default handler's reuse branch produces the same numbering
        // as the ref-above-def ordering.
        if (!s.footnoteCounts.has(id)) s.footnoteCounts.set(id, 0);
      }
      return undefined; // never emit inline hast
    },

    linkReference: ((state: unknown, node: LinkReference): HastElement | undefined => {
      const s = state as StateShape;
      const id = normalizeId(node.identifier);
      const resolved = s.definitionById.has(id);
      if (!resolved) {
        // Unreachable in coordinated pipeline because the phantom suffix
        // guarantees a def for every referenced label that survives PASS 0.5.
        // Verified by experiment: remark-parse produces a `linkReference`
        // mdast node ONLY when a corresponding `[label]:` exists in the
        // source — without one, the brackets are emitted as plain text by
        // the parser, so neither this handler nor mdast's default ever
        // sees the reference. Defense-in-depth for an impossible state.
        return undefined;
      }
      return {
        type: 'element',
        tagName: 'cross-chunk-link',
        properties: {
          // `label` is the ORIGINAL source text (mdast's `label` field), NOT
          // the normalized `identifier`. The placeholder uses it to construct
          // hrefs that line up with mdast-util-to-hast's default `<li id>`
          // which also preserves source case. Registry lookups normalize
          // internally, so cross-chunk case-insensitive matching still works.
          label: node.label ?? node.identifier,
          referenceType: node.referenceType,
          documentId: s.options.documentId,
        },
        children: s.all(node) as HastElement['children'],
      };
    }) as Handlers['linkReference'],

    imageReference: ((state: unknown, node: ImageReference): HastElement | undefined => {
      const s = state as StateShape;
      const id = normalizeId(node.identifier);
      const resolved = s.definitionById.has(id);
      if (!resolved) return undefined;
      return {
        type: 'element',
        tagName: 'cross-chunk-image',
        properties: {
          label: node.label ?? node.identifier,
          referenceType: node.referenceType,
          alt: node.alt ?? '',
          documentId: s.options.documentId,
        },
        children: [],
      };
    }) as Handlers['imageReference'],

    footnoteReference: ((state: unknown, node: FootnoteReference): HastElement => {
      const s = state as StateShape;
      const id = normalizeId(node.identifier);
      // Bump the per-id counter for ALL refs (phantom and real). The result
      // is the chunk-local occurrence index (1, 2, 3, …) which the placeholder
      // carries so FootnoteSupNumber can disambiguate duplicate fnref-* ids
      // when the same label is referenced multiple times. For phantom refs
      // bumping is safe: state.footer() emits <li> only for ids in
      // footnoteOrder, and phantoms never get pushed there.
      const localOccurrence = (s.footnoteCounts.get(id) ?? 0) + 1;
      s.footnoteCounts.set(id, localOccurrence);
      if (s.options.phantomFootnoteLabels.has(id)) {
        return {
          type: 'element',
          tagName: 'footnote-sup',
          properties: {
            label: node.identifier,
            localOccurrence,
            documentId: s.options.documentId,
          },
          children: [],
        };
      }
      // Real local def: register in footnoteOrder so the local synthetic
      // footer can emit a <li> for it.
      if (!s.footnoteOrder.includes(id)) s.footnoteOrder.push(id);
      return {
        type: 'element',
        tagName: 'footnote-sup',
        properties: {
          label: node.identifier,
          localOccurrence,
          documentId: s.options.documentId,
        },
        children: [],
      };
    }) as Handlers['footnoteReference'],
  };
}
