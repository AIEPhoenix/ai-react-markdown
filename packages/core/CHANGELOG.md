# Changelog

## Unreleased

### Added

- `<AIMarkdownDocuments>` wrapper enabling cross-chunk coordination
  for footnote / linkReference / imageReference references across
  multiple `<AIMarkdown>` instances sharing a `documentId`.
- `config.preserveOrphanReferences` (default `true`): protects orphan
  footnote definitions from being silently dropped by
  `mdast-util-to-hast` when no matching `footnoteReference` exists.
  Set to `false` to revert to prior silent-drop behavior.
- `AIMarkdownRenderState.clobberPrefix` exposed (derived from
  `documentId`); useful for custom components needing the canonical
  id prefix used by anchor links.
- Block-memo: per-block fingerprint cache for blocks containing
  footnote / link / image / definition nodes. Cache hits when the
  registry-derived state for the block is unchanged, skipping
  deep-clone + transform + renderHastSubtree.

### Internal

- Custom mdast-util-to-hast handlers for cross-chunk label
  resolution (Direction A orphan protection + Direction B phantom
  injection).
- Per-block hast transformers `transformStripBackrefs` and
  `transformCanonicalStrip` for backref cleanup + canonical-only li
  rendering, composed via `composeHastTransform`.
