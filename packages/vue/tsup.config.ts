import { defineConfig } from 'tsup';

// Keep the engine external: its registry state must have a single owner.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    external: ['vue', '@ai-markdown/engine', '@ai-markdown/core'],
    env: { NODE_ENV: 'production' },
  },
  {
    entry: { 'index.dev': 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    external: ['vue', '@ai-markdown/engine', '@ai-markdown/core'],
    env: { NODE_ENV: 'development' },
  },
]);
