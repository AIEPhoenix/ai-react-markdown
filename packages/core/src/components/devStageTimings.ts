/**
 * Dev-only pipeline stage timing.
 *
 * The block-memo render path runs four distinct stages per content change
 * (parse → transform → build → render). Which one dominates depends on the
 * workload — plugin mix, document length, math density — and every
 * optimization decision should start from that split, not from a guess.
 * {@link measureStage} emits one `performance.measure` entry per stage
 * execution, named `ai-markdown:stage:<stage>`, so any live
 * PerformanceObserver (the DevTools Performance panel's tracing, the
 * BlockMemoCompare story's profiler) can aggregate them without the
 * library depending on the observer.
 *
 * Delivery contract: entries are cleared from the global User Timing
 * buffer immediately after emission — already-registered observers still
 * receive them (delivery is queued at creation), but buffer readers
 * (`performance.getEntriesByType('measure')` in the console, late
 * `buffered: true` observers) see nothing. That is the price of never
 * growing the page-global buffer from a render hot path (~4 entries per
 * streamed token, observer or not). The DevTools Performance panel is
 * unaffected — it captures measures from the trace, not the buffer.
 *
 * Production builds fold {@link ENABLED} to `false`: the dual dev/prod
 * build resolves `process.env.NODE_ENV` at build time (tsup `env`), so
 * the published dist carries no env read at all; in-repo src consumers
 * (storybook, vitest) run under Vite/Node where the text is substituted
 * or `process` exists. The whole thing costs one boolean check per stage.
 *
 * @module components/devStageTimings
 */

/** The stages of the block-memo render pipeline, in execution order.
 *  Single source of truth: the union type, the emitted measure names, and
 *  any display ordering (ProfilerPanel) all derive from this tuple. */
export const PIPELINE_STAGES = ['parse', 'transform', 'build', 'render'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Prefix for the emitted `performance.measure` entry names. */
export const STAGE_MEASURE_PREFIX = 'ai-markdown:stage:';

/** Hoisted name table — measure names are shared constants, not a fresh
 *  template-literal allocation per call. */
const STAGE_NAMES = Object.fromEntries(
  PIPELINE_STAGES.map((stage) => [stage, `${STAGE_MEASURE_PREFIX}${stage}`])
) as Record<PipelineStage, string>;

/**
 * One-time capability gate. Beyond the DEV check, probes the exact calls
 * {@link measureStage} makes — the options-object `measure` overload AND
 * `clearMeasures` — by performing them once. Environments that expose
 * `performance.measure` but only support the legacy mark-name overloads
 * (older jsdom, partial polyfills) fail the probe and are gated off
 * permanently, instead of paying a thrown-and-swallowed exception per
 * stage per token for the whole session.
 */
const ENABLED: boolean =
  process.env.NODE_ENV !== 'production' &&
  (() => {
    if (
      typeof performance === 'undefined' ||
      typeof performance.measure !== 'function' ||
      typeof performance.clearMeasures !== 'function'
    ) {
      return false;
    }
    try {
      const probe = `${STAGE_MEASURE_PREFIX}probe`;
      performance.measure(probe, { start: 0, end: 0 });
      performance.clearMeasures(probe);
      return true;
    } catch {
      return false;
    }
  })();

/**
 * Run `fn` as the named pipeline stage, emitting its `performance.measure`
 * in dev. The single-callable shape (instead of a start/end pair) makes
 * the stage name a typed argument and the pairing unforgettable: a call
 * site cannot mismatch or drop an end call. If `fn` throws, no measure is
 * emitted for the aborted stage.
 */
export function measureStage<T>(stage: PipelineStage, fn: () => T): T {
  if (!ENABLED) return fn();
  const start = performance.now();
  const result = fn();
  const name = STAGE_NAMES[stage];
  // Probe-verified calls — no per-call try/catch needed. See the module
  // docs for why the entry is cleared immediately after emission.
  performance.measure(name, { start, end: performance.now() });
  performance.clearMeasures(name);
  return result;
}
