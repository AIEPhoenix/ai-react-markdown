/** Public documentation links shared by all Storybook catalogs. */
const GUIDES_BASE = 'https://ai-markdown.github.io/docs/guides';

export const DOCS_LINKS = {
  architecture: `${GUIDES_BASE}/architecture/`,
  benchmark: `${GUIDES_BASE}/benchmark/`,
  'cjk-typography': `${GUIDES_BASE}/cjk-typography/`,
  'content-preprocessors': `${GUIDES_BASE}/content-preprocessors/`,
  'cross-chunk-coordination': `${GUIDES_BASE}/cross-chunk-coordination/`,
  'custom-components': `${GUIDES_BASE}/custom-components/`,
  'custom-typography': `${GUIDES_BASE}/custom-typography/`,
  'design-tokens': `${GUIDES_BASE}/design-tokens/`,
  'extending-via-subpackage': `${GUIDES_BASE}/extending-via-subpackage/`,
  'metadata-context': `${GUIDES_BASE}/metadata-context/`,
  'migrating-to-v2': `${GUIDES_BASE}/migrating-to-v2/`,
  readme: `${GUIDES_BASE}/`,
  'release-highlights': `${GUIDES_BASE}/release-highlights/`,
  'smooth-streaming': `${GUIDES_BASE}/smooth-streaming/`,
  'streaming-and-performance': `${GUIDES_BASE}/streaming-and-performance/`,
  'streaming-chat-example': `${GUIDES_BASE}/streaming-chat-example/`,
  'streaming-cursor': `${GUIDES_BASE}/streaming-cursor/`,
  'typescript-generics': `${GUIDES_BASE}/typescript-generics/`,
  'url-sanitization': `${GUIDES_BASE}/url-sanitization/`,
} as const;

export type DocSlug = keyof typeof DOCS_LINKS;

/** A markdown link to a guide, for `parameters.docs.description.component`. */
export const docsLink = (slug: DocSlug, label: string): string => `[${label}](${DOCS_LINKS[slug]})`;

/** The repository root, for stories that want to point at source rather than docs. */
export const REPO_URL = 'https://github.com/ai-markdown/ai-markdown';
