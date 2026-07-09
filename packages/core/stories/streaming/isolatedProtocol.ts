/**
 * postMessage protocol between the isolated-comparison HOST story and the
 * two single-side iframes.
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

/** Host → side. */
export type HostToSideMessage =
  | { type: 'bmc:start' }
  | { type: 'bmc:chunk'; text: string }
  | { type: 'bmc:stop' }
  | { type: 'bmc:reset' };

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
