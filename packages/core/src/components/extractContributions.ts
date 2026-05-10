/**
 * Walk an mdast tree and yield ref/def records in source order. Used by
 * AIMarkdownContent's PASS 1 contribute step to populate Registry.chunkData.
 *
 * Phantom definitions (Direction B) carry sentinel content/url but the
 * sentinel parse may not produce exactly the sentinel string at the AST
 * level (e.g. `__aimd_sentinel_fn__` parses as <strong>aimd_sentinel_fn</strong>).
 * Therefore phantom detection is done both ways:
 *   - linkDef: check `url === SENTINEL_LINK_URL` (raw string survives parsing).
 *   - fnDef: skip if the def's normalized identifier is in the supplied
 *            `phantomFootnoteLabels` set. The caller knows which labels it
 *            injected (PASS 0.5 `targetPhantoms.missingFootnotes`).
 *
 * @module components/extractContributions
 */
import { SKIP, visit } from 'unist-util-visit';
import type { Root as MdastRoot } from 'mdast';
import { normalizeId } from './normalizeId';
import { SENTINEL_LINK_URL } from './remarkInjectPhantomDefs';

export type Contribution =
  | {
      kind: 'ref';
      refKind: 'footnote' | 'link' | 'image';
      label: string;
      referenceType?: 'full' | 'collapsed' | 'shortcut';
    }
  | { kind: 'fnDef'; label: string; sourceIdentifier: string; content: string }
  | { kind: 'linkDef'; label: string; url: string; title?: string };

export interface ExtractContributionsOptions {
  /** Already-normalized labels that were phantom-injected at PASS 0.5.
   *  Defs matching these are skipped to avoid leaking sentinel rows into
   *  registry.chunkData. */
  phantomFootnoteLabels?: Set<string>;
}

export function* extractContributions(
  mdast: MdastRoot,
  options: ExtractContributionsOptions = {}
): Generator<Contribution> {
  const phantomFn = options.phantomFootnoteLabels;
  const out: Contribution[] = [];
  visit(mdast, (n) => {
    if (n.type === 'footnoteReference') {
      out.push({
        kind: 'ref',
        refKind: 'footnote',
        label: normalizeId((n as { identifier: string }).identifier),
      });
    } else if (n.type === 'linkReference') {
      const r = n as { identifier: string; referenceType: 'full' | 'collapsed' | 'shortcut' };
      out.push({ kind: 'ref', refKind: 'link', label: normalizeId(r.identifier), referenceType: r.referenceType });
    } else if (n.type === 'imageReference') {
      const r = n as { identifier: string; referenceType: 'full' | 'collapsed' | 'shortcut' };
      out.push({ kind: 'ref', refKind: 'image', label: normalizeId(r.identifier), referenceType: r.referenceType });
    } else if (n.type === 'footnoteDefinition') {
      const d = n as { identifier: string; children: unknown[] };
      const label = normalizeId(d.identifier);
      // Skip phantom-injected (by injected-label set, since the sentinel
      // string may not survive markdown parsing intact).
      if (phantomFn?.has(label)) return SKIP;
      // Best-effort raw content snapshot: stringify the first child's
      // structure. Footnote definitions are typed `(BlockContent | DefinitionContent)[]`
      // so we serialize loosely. Used only as a coarse fingerprint string.
      const content = JSON.stringify(d.children ?? []);
      // d.identifier is mdast's already-case-folded form — the same string
      // mdast-util-to-hast uses in `<li id="...fn-${id}">`. Tracked separately
      // from the uppercase-normalized `label` (used as a dictionary key) so
      // HTML ids built downstream match the inline sup's href byte-for-byte.
      //
      // bodyHast is NOT computed here — see extractDefBodiesFromHast for
      // why we source it from the post-pipeline hast instead.
      out.push({ kind: 'fnDef', label, sourceIdentifier: d.identifier, content });
      // SKIP descent into the def's children: NESTED footnoteReferences /
      // linkReferences / imageReferences inside a def body should NOT
      // count as flow refs. Without this, a def whose body contains
      // `[^x]: see [^a].` would record an extra ref to `a` in registry
      // refs — inflating `globalNumber('a')` (making `a` appear in the
      // aggregate footer even if no flow text references it), and worse,
      // inflating `getRefsForLabel('a')` so the aggregate emits a backref
      // anchor to `#fnref-a-2` that points at an id no inline `<sup>`
      // ever rendered. Trade-off: a footnoteDefinition nested INSIDE
      // another def's body (allowed by GFM but exceedingly rare) is also
      // not extracted; deferred until we see a real use case.
      return SKIP;
    } else if (n.type === 'definition') {
      const d = n as { identifier: string; url: string; title?: string };
      if (d.url === SENTINEL_LINK_URL) return;
      out.push({ kind: 'linkDef', label: normalizeId(d.identifier), url: d.url, title: d.title });
    }
  });
  for (const c of out) yield c;
}
