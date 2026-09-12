# Vue SSR and lifecycle

The Vue adapter supports server rendering and hydration with Vue `^3.5.0`. Use the same initial content and application structure on the server and first client render. Vue's `useId()` supplies application-local IDs that can match across that boundary.

## What the server renders

The server uses a full parse and renders actual Vue VNodes. It does not insert the Markdown result through `v-html` or `innerHTML`. Smooth components show their initial content completely; they begin animating future appends after mounting.

Document contributions are not registered or published during SSR or the first hydration render. Each chunk initially has local references and footnotes. Cross-chunk resolution begins after mounted contributions commit. Use a single renderer with the complete source when server-only output needs all definitions resolved.

## Own state at the right lifetime

Call smooth composables during setup with getters over live state. The adapter creates browser controllers and watchers on mount and releases them on unmount. Cursor observers and animation frames are also released on unmount.

Use stable component keys for the same section and new identities for new coordinated sequences. A document switch releases the previous registration. Keep any application-owned mutable document state local to its request or owning component, rather than sharing it globally between SSR requests.

If building a low-level wrapper around core, keep trees, registries and coordinators in shallow Vue references. Deep reactive proxies change identity assumptions used by the shared layer. See [core and engine contracts](api/core-engine-contracts.md).

## Supported integration evidence

Repository tests cover standalone hydration, document references and switching, customization, smooth waiting/drain and cursor behavior in Chromium, Firefox and WebKit. Bounded ownership/forced-GC checks are Chromium-specific. Packed consumers exercise ESM/CJS, declarations, CSS and server rendering outside the workspace.

These checks do not establish Nuxt-specific packaging or KeepAlive/Suspense combinations. Those integrations need their own coverage before being treated as supported. See the [Vue verification reference](../reference/vue.md#verification-and-scope) for commands and the precise test scope.
