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
import type { Element as HastElement } from 'hast';
import { normalizeId } from '@ai-react-markdown/engine';
import { SENTINEL_LINK_URL } from './remarkInjectPhantomDefs';
import type { UrlTransform } from './markdown';

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
  /**
   * Caller's resolved URL transform (typically `props.urlTransform ??
   * defaultUrlTransform`). Applied to every emitted `linkDef.url` so the
   * registry stores already-sanitized URLs.
   *
   * Cross-chunk link/image references render through the registry rather
   * than the in-tree hast (which is where react-markdown's transform pass
   * normally enforces `urlTransform`). Without this, a chunk defining
   * `[evil]: javascript:alert(1)` could XSS a sibling chunk that uses
   * `[click][evil]` — the standalone path strips the protocol; the cross-
   * chunk path would have rendered `<a href="javascript:…">`. Sanitizing at
   * contribute time also benefits any future consumer that reads
   * `Registry.resolveLinkDef` directly.
   *
   * Invocation contract mirrors react-markdown's hast-pass call site
   * (`buildTransform` in `./markdown/transform.ts`): a synthetic
   * `<a href={url}>` element stands in for the node argument since
   * mdast `definition` nodes have no hast counterpart. The key is `'href'`
   * — link defs are far more common than image defs, and protocol-allowlist
   * transforms (including `defaultUrlTransform`) are key-agnostic anyway.
   * A `null` return collapses to the empty string, matching how
   * `transform.ts` would render a blocked attribute.
   *
   * Omitting this option preserves v1 behavior (URLs stored raw). Library
   * callers should always supply it; the option stays optional so unit-test
   * fixtures that don't care about URL safety can construct minimal calls.
   */
  urlTransform?: UrlTransform;
}

/** Synthetic hast element used as the third argument to `urlTransform` at
 *  contribute time. `transform.ts` passes a real Element with all the
 *  reference's properties; here we only have the bare def URL, so a minimal
 *  stand-in suffices. `defaultUrlTransform` ignores it; key-aware custom
 *  transforms see a sensible default shape. */
function fakeAnchorElement(url: string): HastElement {
  return { type: 'element', tagName: 'a', properties: { href: url }, children: [] };
}

function sanitizeDefUrl(url: string, urlTransform: UrlTransform | undefined): string {
  if (!urlTransform) return url;
  const result = urlTransform(url, 'href', fakeAnchorElement(url));
  return result == null ? '' : String(result);
}

export function* extractContributions(
  mdast: MdastRoot,
  options: ExtractContributionsOptions = {}
): Generator<Contribution> {
  const phantomFn = options.phantomFootnoteLabels;
  const urlTransform = options.urlTransform;
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
      out.push({
        kind: 'linkDef',
        label: normalizeId(d.identifier),
        url: sanitizeDefUrl(d.url, urlTransform),
        title: d.title,
      });
    }
  });
  for (const c of out) yield c;
}
