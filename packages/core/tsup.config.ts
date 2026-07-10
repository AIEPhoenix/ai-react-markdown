import { defineConfig } from 'tsup';

const shared = {
  format: ['cjs', 'esm'] as const,
  sourcemap: true,
  external: ['react', 'react-dom'],
  noExternal: ['lodash-es'],
  // NO `treeshake: true` here: tsup's rollup treeshake pass strips the
  // module-level "use client" directive (verified), which would break RSC
  // consumers. The cost is that env replacement leaves inert `if (false)`
  // bodies in the output — a few KB that never execute and that any
  // consumer minifier removes; safety doesn't depend on them being gone.
};

/**
 * Dual dev/prod build (react/redux-style), selected by the `development`
 * exports condition in package.json.
 *
 * Source keeps writing bare `process.env.NODE_ENV` gates everywhere; both
 * builds resolve them at BUILD time, so neither published file contains a
 * `process` reference. That kills an entire crash class: in a no-bundler
 * runtime (browser native ESM / CDN import, Deno) evaluating a bare gate
 * throws `ReferenceError: process is not defined` — and resolvers that
 * don't know the `development` condition fall through to the production
 * build, making "safe" the default for unknown consumers.
 */
export default defineConfig([
  // Production build: gates fold to false, dev-only branches are
  // dead-code-eliminated. This is what `import`/`require` (and the
  // top-level main/module fields) point at.
  {
    ...shared,
    entry: ['src/index.tsx'],
    dts: true,
    clean: true,
    env: { NODE_ENV: 'production' },
  },
  // Development build: gates fold to true — warnings and dev invariants
  // always on. Picked up by resolvers that know the `development`
  // condition (Vite dev, webpack/Next in development mode).
  {
    ...shared,
    entry: { 'index.dev': 'src/index.tsx' },
    dts: false,
    clean: false,
    env: { NODE_ENV: 'development' },
  },
]);
