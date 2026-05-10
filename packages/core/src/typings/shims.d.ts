/** Ambient type declaration for packages that do not ship their own types. */
declare module 'remark-pangu' {
  import type { Plugin } from 'unified';
  /** Unified plugin: auto-inserts spaces between CJK and half-width characters. */
  const remarkPangu: Plugin;
  export default remarkPangu;
}

/**
 * Minimal ambient `process` for guarded dev-only invariants. Consumers'
 * bundlers (Vite, webpack, Next) replace `process.env.NODE_ENV` with a string
 * literal at build time, matching React's own pattern.
 */
declare const process: { env: { NODE_ENV?: string } };
