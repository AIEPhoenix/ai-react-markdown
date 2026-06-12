/**
 * Ambient declaration for style imports. The styles are compiled and bundled
 * by the tsup build (esbuild-sass-plugin); for `tsc --noEmit` the import only
 * needs to resolve.
 */
declare module '*.scss';
