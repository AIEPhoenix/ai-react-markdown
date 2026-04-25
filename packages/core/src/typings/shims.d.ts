/** Ambient type declaration for packages that do not ship their own types. */
declare module 'remark-pangu' {
  import type { Plugin } from 'unified';
  /** Unified plugin: auto-inserts spaces between CJK and half-width characters. */
  const remarkPangu: Plugin;
  export default remarkPangu;
}
