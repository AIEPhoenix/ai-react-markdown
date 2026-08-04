/**
 * Export-surface guard: the v1 API stays deleted and the v2 surface stays
 * present. Runtime-value guard only — deleted TYPES (e.g. the v1
 * `AIMarkdownRenderConfig`) leave no runtime trace, so listing them here
 * would assert nothing; they are covered by the compile step instead (any
 * resurrected type would need a value import site to matter).
 */
import { describe, expect, test } from 'vitest';
import * as core from '.';

const DELETED_V1_VALUES = ['useAIMarkdownRenderState', 'AIMarkdownRenderStateProvider'];

const REQUIRED_V2_VALUES = [
  'useAIMarkdownDocument',
  'useAIMarkdownTheme',
  'useAIMarkdownState',
  'useAIMarkdownBehaviors',
  'useAIMarkdown',
  'useAIMarkdownMetadata',
  'AIMarkdownBehaviorsProvider',
  'AIMarkdownStateProvider',
  'defineTheme',
  'defineBehaviors',
  'definePipeline',
  'useStableRecord',
  'AIMarkdownStabilityPolicy',
  'AIMarkdownStreamingCursor',
  'AIMarkdownSmoothStream',
  'useSmoothStream',
  'createSmoothStreamController',
  'SMOOTH_STREAM_PACING_PRESETS',
  'AIMarkdownDocuments',
  'useDocumentRegistry',
  'extendSanitizeSchema',
  'defaultUrlTransform',
  'createRemendPreprocessor',
];

describe('export surface — v1 deletions stay deleted, v2 surface stays whole', () => {
  test.each(DELETED_V1_VALUES)('v1 symbol %s is not exported', (name) => {
    expect(name in core).toBe(false);
  });

  test.each(REQUIRED_V2_VALUES)('v2 symbol %s is exported', (name) => {
    expect(core).toHaveProperty(name);
  });
});
