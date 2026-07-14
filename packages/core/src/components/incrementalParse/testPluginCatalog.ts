/**
 * TEST-ONLY helper (imported by the incrementalParse test files; never by
 * production code or the package barrel).
 *
 * Builds `AdvanceOptions` that mirror `MarkdownContent.tsx`'s standalone
 * assembly EXACTLY — same plugin order as the `remarkPlugins`/`rehypePlugins`
 * memos, same merged remark-rehype options as the `parsed` memo (standalone
 * default: `preserveOrphanReferences` → only the `footnoteDefinition`
 * handler, empty phantom label sets, `preserveOrphan: true`, documentId).
 * The splice-equivalence arbiter derives its authority from this mirroring:
 * if the option assembly here drifts from the component's, the arbiter
 * stops testing the production pipeline. Cross-check against
 * `MarkdownContent.tsx` (plugin memos + `parsed` memo) when either changes;
 * `byteEquivalence.test.tsx`'s `legacyPlugins()` pins the same order.
 *
 * The permutation catalog spans the config axes the way
 * `byteEquivalence.test.tsx` does — including ALL-DEFAULTS-ON, which the
 * original prefixFreeze experiment did not cover (hole H2).
 */

import { defListHastHandlers } from 'remark-definition-list';

import { sanitizeSchema } from '../sanitizeSchema';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins } from '../pluginChain';
import { buildCrossChunkHandlers } from '../customMdastHandlers';
import { AIMarkdownRenderDisplayOptimizeAbility, AIMarkdownRenderExtraSyntax } from '../../defs';
import type { AdvanceOptions } from './advanceIncrementalParse';

export interface CatalogConfig {
  label: string;
  highlight: boolean;
  defList: boolean;
  removeComments: boolean;
  smartypants: boolean;
  pangu: boolean;
}

export const CATALOG: CatalogConfig[] = [
  { label: 'baseline', highlight: false, defList: false, removeComments: false, smartypants: false, pangu: false },
  { label: 'defaults-all-on', highlight: true, defList: true, removeComments: true, smartypants: true, pangu: true },
  { label: 'def-list-only', highlight: false, defList: true, removeComments: false, smartypants: false, pangu: false },
  { label: 'display-only', highlight: false, defList: false, removeComments: true, smartypants: true, pangu: true },
];

const TEST_DOCUMENT_ID = 'ip';
const TEST_CLOBBER_PREFIX = `${encodeURIComponent(TEST_DOCUMENT_ID)}-user-content-`;
const EMPTY_SET: ReadonlySet<string> = new Set();

export function buildAdvanceOptions(config: CatalogConfig): AdvanceOptions {
  // Standalone default mode: preserveOrphanReferences=true → ONLY the
  // footnoteDefinition handler (MarkdownContent.tsx `handlers` memo).
  const { footnoteDefinition } = buildCrossChunkHandlers();
  const remarkRehypeOptions = {
    allowDangerousHtml: true,
    clobberPrefix: '',
    handlers: {
      ...(config.defList ? defListHastHandlers : {}),
      footnoteDefinition,
    },
    phantomFootnoteLabels: EMPTY_SET,
    phantomLinkLabels: EMPTY_SET,
    preserveOrphan: true,
    documentId: TEST_DOCUMENT_ID,
  };

  // The chains come from pluginChain.ts — the SAME builders MarkdownContent
  // calls, so the arbiter can never drift from the shipped order (the axes
  // here map onto the config enums the production memos consume).
  const extras = [
    ...(config.highlight ? [AIMarkdownRenderExtraSyntax.HIGHLIGHT] : []),
    ...(config.defList ? [AIMarkdownRenderExtraSyntax.DEFINITION_LIST] : []),
  ];
  const display = [
    ...(config.removeComments ? [AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS] : []),
    ...(config.smartypants ? [AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS] : []),
    ...(config.pangu ? [AIMarkdownRenderDisplayOptimizeAbility.PANGU] : []),
  ];
  const options: AdvanceOptions = {
    remarkPlugins: buildCoreRemarkPlugins(extras, display),
    rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, TEST_CLOBBER_PREFIX),
    remarkRehypeOptions: remarkRehypeOptions as never,
    depsKey: [config.label],
    defListEnabled: config.defList,
  };
  return options;
}
