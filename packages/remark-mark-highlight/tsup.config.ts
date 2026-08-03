import { defineConfig } from 'tsup';

// Plain dual build — this package has no dev-only gates, so no dev/prod
// split (unlike core). CJS output is the point: the upstream packages this
// one replaces shipped ESM-only exports maps, which is what broke bare
// Node `require()` consumers of core.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: false,
});
