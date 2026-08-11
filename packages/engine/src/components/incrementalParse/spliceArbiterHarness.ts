/**
 * Shared splice-equivalence ARBITER harness — the oracle every incremental
 * verification suite drives (spliceEquivalence fixtures, the fuzz arbiter,
 * the bounded-exhaustive sweep, the sensitivity meta-tests).
 *
 * Contract enforced: for every streaming frame, the `{mdast, hast}` that
 * `advanceIncrementalParse` returns (spliced or not) is DEEP-EQUAL —
 * positions included, no normalization — to a fresh full-pipeline run over
 * the same snapshot (plus phantom suffix in cross-chunk mode).
 *
 * TEST-ONLY module: imports vitest's `expect` and must never be exported
 * from the package index. Deliberately assertion-minimal — it reports
 * StreamStats and lets each call site pin its own incremental-engagement
 * floor (corpora demand >50%, hazard-dense fuzz families legitimately sit
 * far lower; a floor baked in here would fight one of them).
 *
 * @module components/incrementalParse/spliceArbiterHarness
 */

import { expect } from 'vitest';
import isEqual from 'lodash-es/isEqual';

import { parseStage, transformStage } from '../markdown';
import { buildPhantomSuffix } from '../remarkInjectPhantomDefs';
import { advanceIncrementalParse, type AdvanceOptions, type IncrementalParseState } from './advanceIncrementalParse';
import { buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';

/** Test-only env access: the package's ambient `process` shim deliberately
 *  types only NODE_ENV (browser-shippable code must not grow env deps);
 *  vitest runs under real node where arbitrary keys are fine. */
export const testEnv = (key: string): string | undefined => (process.env as Record<string, string | undefined>)[key];

/** Fresh full-pipeline run — the reference the splice must match. */
export function runFull(content: string, config: CatalogConfig): { mdast: unknown; hast: unknown } {
  const options = buildAdvanceOptions(config);
  const parsed = parseStage({
    children: content,
    remarkPlugins: options.remarkPlugins,
    rehypePlugins: options.rehypePlugins,
    remarkRehypeOptions: options.remarkRehypeOptions,
  });
  const hast = transformStage(parsed);
  return { mdast: parsed.mdast, hast };
}

/** Locate the first differing top-level child for a debuggable message. */
export function diffLocation(actual: { children: unknown[] }, expected: { children: unknown[] }): string {
  const max = Math.max(actual.children.length, expected.children.length);
  for (let i = 0; i < max; i++) {
    if (!isEqual(actual.children[i], expected.children[i])) {
      return `first differing top-level child index=${i} actual=${JSON.stringify(actual.children[i])?.slice(0, 300)} expected=${JSON.stringify(expected.children[i])?.slice(0, 300)}`;
    }
  }
  return 'roots differ outside children (position/data)';
}

export interface StreamStats {
  frames: number;
  incrementalFrames: number;
}

/**
 * Chain the state machine across snapshots, asserting per-frame equivalence
 * against a fresh full parse. Returns how often the incremental path ran so
 * callers can assert they exercised what they claim to exercise.
 */
export function assertStreamEquivalence(name: string, snapshots: string[], config: CatalogConfig): StreamStats {
  const options = buildAdvanceOptions(config);
  let state: IncrementalParseState | null = null;
  let incrementalFrames = 0;

  snapshots.forEach((snapshot, frame) => {
    const result = advanceIncrementalParse(state, snapshot, options);
    state = result.nextState;
    if (result.usedIncremental) incrementalFrames += 1;

    const expected = runFull(snapshot, config);
    const label = `${name} [${config.label}] frame=${frame} len=${snapshot.length} boundary=${result.boundary} incremental=${result.usedIncremental}`;
    if (!isEqual(result.hast, expected.hast)) {
      expect.fail(`${label} — hast mismatch: ${diffLocation(result.hast, expected.hast as never)}`);
    }
    if (!isEqual(result.mdast, expected.mdast)) {
      expect.fail(`${label} — mdast mismatch: ${diffLocation(result.mdast, expected.mdast as never)}`);
    }
  });

  return { frames: snapshots.length, incrementalFrames };
}

/** One cross-chunk frame: chunk content plus the registry's missing labels
 *  (which become the phantom suffix). */
export interface FramePair {
  content: string;
  footnotes: string[];
  links: string[];
}

/**
 * Cross-chunk (phantom suffix) arbiter loop. Reference = full parse of
 * `content + suffix` with the SAME options — the suffix is an always-tail
 * input, so the oracle sees exactly what a fresh coordinated parse sees.
 */
export function runCrossChunk(
  name: string,
  frames: FramePair[],
  optionsFor: (f: FramePair) => AdvanceOptions
): { incrementalFrames: number; results: boolean[] } {
  let state: IncrementalParseState | null = null;
  let incrementalFrames = 0;
  const results: boolean[] = [];
  frames.forEach((frame, i) => {
    const suffix = buildPhantomSuffix({
      missingFootnotes: new Set(frame.footnotes),
      missingLinks: new Set(frame.links),
    });
    const options = { ...optionsFor(frame), phantomSuffix: suffix };
    const result = advanceIncrementalParse(state, frame.content, options);
    state = result.nextState;
    if (result.usedIncremental) incrementalFrames += 1;
    results.push(result.usedIncremental);

    const full = parseStage({
      children: frame.content + suffix,
      remarkPlugins: options.remarkPlugins,
      rehypePlugins: options.rehypePlugins,
      remarkRehypeOptions: options.remarkRehypeOptions,
    });
    const fullHast = transformStage(full);
    const label = `${name} frame=${i} len=${frame.content.length} incremental=${result.usedIncremental}`;
    if (!isEqual(result.hast, fullHast)) {
      expect.fail(`${label} — hast mismatch: ${diffLocation(result.hast, fullHast as never)}`);
    }
    if (!isEqual(result.mdast, full.mdast)) {
      expect.fail(`${label} — mdast mismatch: ${diffLocation(result.mdast, full.mdast as never)}`);
    }
  });
  return { incrementalFrames, results };
}
