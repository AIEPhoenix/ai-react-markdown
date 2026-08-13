// Minimal `import.meta.env` shape for the story infrastructure.
//
// `vite/client` normally supplies this, but `vite` is a transitive dependency
// and is not resolvable from the repo root under pnpm's strict layout, so
// `/// <reference types="vite/client" />` cannot be used here. Only the keys
// the stories actually read are declared — which doubles as the list of
// environment signals the story infrastructure depends on.

interface ImportMetaEnv {
  /** 'development' / 'production' under Storybook, 'test' under vitest. */
  readonly MODE: string;
  /** Set by vitest. */
  readonly VITEST?: string | boolean;
  /** Fed from `env` in .storybook/main.ts; '1' for the public export build. */
  readonly STORYBOOK_DOCS_EXPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
