import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Production build only — the benchmark must never measure the dev server's
 *  transform cost or React's development build, both of which are several
 *  times slower than what a user ships. `pnpm bench:web` builds and previews;
 *  `dev` exists for authoring scenarios by hand, not for numbers. */
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
});
