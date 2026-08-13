/**
 * Absolute GitHub URLs for the `docs/` guides.
 *
 * Story descriptions link to the guides constantly, and a relative
 * `../../docs/foo.md` resolves to nothing once Storybook is exported as a
 * static site — the markdown files are not part of the build. Absolute URLs
 * into the repository are the only form that works in the dev server, in the
 * published export, and in a sub-path deployment alike.
 */

const REPO_BLOB_BASE = 'https://github.com/AIEPhoenix/ai-react-markdown/blob/main';

/** Every file in `docs/`, keyed by slug (the filename without `.md`). */
export const DOCS_LINKS = {
  architecture: `${REPO_BLOB_BASE}/docs/architecture.md`,
  benchmark: `${REPO_BLOB_BASE}/docs/benchmark.md`,
  'cjk-typography': `${REPO_BLOB_BASE}/docs/cjk-typography.md`,
  'content-preprocessors': `${REPO_BLOB_BASE}/docs/content-preprocessors.md`,
  'cross-chunk-coordination': `${REPO_BLOB_BASE}/docs/cross-chunk-coordination.md`,
  'custom-components': `${REPO_BLOB_BASE}/docs/custom-components.md`,
  'custom-typography': `${REPO_BLOB_BASE}/docs/custom-typography.md`,
  'design-tokens': `${REPO_BLOB_BASE}/docs/design-tokens.md`,
  'extending-via-subpackage': `${REPO_BLOB_BASE}/docs/extending-via-subpackage.md`,
  'metadata-context': `${REPO_BLOB_BASE}/docs/metadata-context.md`,
  'migrating-to-v2': `${REPO_BLOB_BASE}/docs/migrating-to-v2.md`,
  readme: `${REPO_BLOB_BASE}/docs/README.md`,
  'release-highlights': `${REPO_BLOB_BASE}/docs/release-highlights.md`,
  'smooth-streaming': `${REPO_BLOB_BASE}/docs/smooth-streaming.md`,
  'streaming-and-performance': `${REPO_BLOB_BASE}/docs/streaming-and-performance.md`,
  'streaming-chat-example': `${REPO_BLOB_BASE}/docs/streaming-chat-example.md`,
  'streaming-cursor': `${REPO_BLOB_BASE}/docs/streaming-cursor.md`,
  'typescript-generics': `${REPO_BLOB_BASE}/docs/typescript-generics.md`,
  'url-sanitization': `${REPO_BLOB_BASE}/docs/url-sanitization.md`,
} as const;

export type DocSlug = keyof typeof DOCS_LINKS;

/** A markdown link to a guide, for `parameters.docs.description.component`. */
export const docsLink = (slug: DocSlug, label: string): string => `[${label}](${DOCS_LINKS[slug]})`;

/** The repository root, for stories that want to point at source rather than docs. */
export const REPO_URL = 'https://github.com/AIEPhoenix/ai-react-markdown';
