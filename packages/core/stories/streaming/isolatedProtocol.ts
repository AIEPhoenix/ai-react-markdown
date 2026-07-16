/**
 * postMessage protocol between the isolated-comparison HOST story and the
 * two single-side iframes — plus the comparison-AXIS single source shared
 * by every A/B variant (isolated and same-page alike).
 *
 * ## Why iframes, and why cross-SITE specifically
 *
 * Same-origin (and same-site) iframes share the parent's renderer process
 * and main thread — the spec requires it, because same-origin frames may
 * synchronously script each other's DOM. An iframe split alone therefore
 * buys zero isolation. Chrome's Site Isolation puts CROSS-SITE iframes in
 * separate renderer processes (OOPIF): separate main threads, separate V8
 * heaps/GC, separate event loops and rAF cadences. The host exploits the
 * fact that `localhost` and `127.0.0.1` are different hosts — and therefore
 * different SITES — pointing at the same dev server: one iframe loads via
 * each, making the two sides cross-site to each other with no extra server.
 *
 * Note: the site key ignores ports, so `localhost:6006` vs `localhost:6007`
 * would NOT separate processes. It must be the hostname that differs.
 *
 * ## Message security
 *
 * This is a dev-only benchmark harness: messages are validated by shape
 * (`type` prefix) and, host-side, by `event.source` identity against the
 * two owned iframes — not by origin allowlists. Do not copy this pattern
 * into production messaging code.
 *
 * @module stories/streaming/isolatedProtocol
 */

import type { RenderProfilerSnapshot } from './useRenderProfiler';

export type SideMode = 'memo' | 'legacy';

/**
 * ## Comparison axes — single source
 *
 * Which A/B a comparison runs. Everything derivable from the axis lives
 * here: the union, each side's engine wiring, and the panel headings. The
 * host URL builder, the side page's param parser, and the same-page
 * variant table all consume these — four modules used to hold half a
 * mapping each, and a fourth axis could be added to one without the others
 * noticing (the side's parser silently measured `blockMemo` instead).
 */
export const COMPARISON_AXES = ['blockMemo', 'incrementalParse', 'boost'] as const;
export type ComparisonAxis = (typeof COMPARISON_AXES)[number];

/** One side's engine wiring: which renderer path plus the incremental flag. */
export interface AxisSideSpec {
  mode: SideMode;
  incremental: boolean;
}

/** What each axis actually compares, per side. */
export const AXIS_SIDES: Record<ComparisonAxis, { on: AxisSideSpec; off: AxisSideSpec }> = {
  /** memo vs legacy — the block-memo cache itself. */
  blockMemo: {
    on: { mode: 'memo', incremental: false },
    off: { mode: 'legacy', incremental: false },
  },
  /** BOTH sides block-memo; only the incremental flag differs. */
  incrementalParse: {
    on: { mode: 'memo', incremental: true },
    off: { mode: 'memo', incremental: false },
  },
  /** everything on vs everything off — the end-to-end boost. */
  boost: {
    on: { mode: 'memo', incremental: true },
    off: { mode: 'legacy', incremental: false },
  },
};

/** Engine config for one side, derived from its spec — the only place the
 *  mode→flag translation is written down. */
export const sideConfig = (spec: AxisSideSpec) =>
  ({ blockMemoEnabled: spec.mode === 'memo', incrementalParseEnabled: spec.incremental }) as const;

/** Panel headings per axis — shared by the isolated side page and the
 *  same-page comparison columns so the copy can't drift. */
export const AXIS_HEADINGS: Record<ComparisonAxis, { on: string; off: string }> = {
  blockMemo: { on: 'blockMemoEnabled: true (default)', off: 'blockMemoEnabled: false (legacy)' },
  incrementalParse: { on: 'incrementalParseEnabled: true', off: 'incrementalParseEnabled: false' },
  boost: { on: 'boost: block-memo + incremental (all on)', off: 'legacy: full pipeline every frame (all off)' },
};

/**
 * Parse a `bmcAxis` URL param. Absent → 'blockMemo' (the side story is
 * openable standalone, where the default is the plain memo-vs-legacy side).
 * An UNRECOGNIZED value throws instead of falling back: the host builds the
 * param from typed values, so a mismatch here means the axis list and a
 * consumer desynced — measuring the wrong axis silently is the one failure
 * mode this module exists to prevent.
 */
export function parseComparisonAxis(raw: string | null): ComparisonAxis {
  if (raw === null) return 'blockMemo';
  if ((COMPARISON_AXES as readonly string[]).includes(raw)) return raw as ComparisonAxis;
  throw new Error(`Unknown bmcAxis ${JSON.stringify(raw)} — expected one of: ${COMPARISON_AXES.join(', ')}`);
}

/** Host → side. */
export type HostToSideMessage =
  { type: 'bmc:start' } | { type: 'bmc:chunk'; text: string } | { type: 'bmc:stop' } | { type: 'bmc:reset' };

/** Side → host. Deliberately carries NO self-identification: the host
 *  attributes every message by `event.source` identity against its two
 *  owned iframes. A claimed `mode` field would only invite routing by
 *  attacker-controllable data instead of by that identity check. */
export type SideToHostMessage = { type: 'bmc:ready' } | { type: 'bmc:snapshot'; snapshot: RenderProfilerSnapshot };

export const isProtocolMessage = (data: unknown): data is HostToSideMessage | SideToHostMessage =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as { type?: unknown }).type === 'string' &&
  (data as { type: string }).type.startsWith('bmc:');

/** Storybook story id of the single-side story (title `Core/AIMarkdown`,
 *  export `BlockMemoSide`). Used to build the iframe URLs. */
export const SIDE_STORY_ID = 'core-aimarkdown--block-memo-side';
