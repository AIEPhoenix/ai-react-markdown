import { defineConfig, type Options } from 'tsup';

// Typed so misspelled/renamed keys fail the config typecheck — spread-in
// properties bypass excess-property checking at the use sites below.
//
// NOTE: no `external: ['react', ...]` here and none may ever be added —
// this package is framework-agnostic by contract. React must not appear in
// dependencies, peerDependencies, or the bundle. The typecheck enforces it
// (react types are simply not resolvable from this package).
const shared: Options = {
  format: ['cjs', 'esm'],
  sourcemap: true,
  // NO `treeshake: true` here: tsup's rollup treeshake pass strips
  // module-level directives (verified in core), and the cost of the env
  // replacement leaving inert `if (false)` bodies is a few KB that never
  // execute; any consumer minifier removes them.
};

/**
 * Dual dev/prod build, selected by the `development` exports condition in
 * package.json — same regime as core (see core/tsup.config.ts for the full
 * rationale): both builds fold `process.env.NODE_ENV` at BUILD time so no
 * published file contains a `process` reference, which would throw in
 * no-bundler runtimes (browser native ESM/CDN, Deno).
 */
export default defineConfig([
  // Production build. `clean` must stay FALSE on both configs: tsup builds
  // array configs concurrently, so a clean here races the other config's
  // file writes. The build script rm -rf's dist BEFORE tsup starts instead.
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    dts: true,
    clean: false,
    env: { NODE_ENV: 'production' },
  },
  // Development build: gates fold to true — dev invariants always on.
  {
    ...shared,
    entry: { 'index.dev': 'src/index.ts' },
    dts: false,
    clean: false, // see above — never clean from inside the array
    env: { NODE_ENV: 'development' },
  },
]);
