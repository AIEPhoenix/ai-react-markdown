/**
 * Shared development-mode gate for MODULE-SCOPE consumers.
 *
 * The repo needs two different idioms for the NODE_ENV check, and picking
 * the wrong one produces real, opposite bugs (both observed):
 *
 * - **Function-body gates** (`if (process.env.NODE_ENV !== 'production')`
 *   inline, as in blockMemo.ts / AIMarkdownDocuments.tsx): keep them BARE.
 *   Bundlers substitute exactly that text, so production builds fold the
 *   branch away and dead-code-eliminate the body per call site. A
 *   `typeof process` guard would survive substitution, evaluate to
 *   `'undefined'` in the browser, and silently disable the dev path in
 *   bundler dev builds (this exact bug shipped in
 *   `useReferenceFlipWarning`'s original `__DEV__`). Bare access can only
 *   throw in unreplaced non-Node runtimes, where the crash is confined to
 *   the dev code path that executed it.
 *
 * - **Module-scope gates** (a `const DEV = …` evaluated at import): bare
 *   access is NOT safe here — in an unreplaced non-Node runtime (browser
 *   native ESM / CDN import of the published dist, Deno) the throw happens
 *   at import time and takes the whole module graph down, production
 *   included. Import THIS constant instead: the try/catch confines the
 *   probe, bundlers still substitute the inner text and fold the IIFE, and
 *   every module-scope consumer shares one decision point.
 */
export const DEV: boolean = (() => {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    // `process` is undefined and the bundler did not substitute the text
    // (no-bundler browser ESM, Deno): treat as production — dev warnings
    // and telemetry off, nothing crashes.
    return false;
  }
})();
