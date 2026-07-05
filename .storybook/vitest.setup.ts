// Intentionally empty. Since Storybook 10.3, @storybook/addon-vitest applies
// the project's preview annotations (./preview) and every addon's preview
// annotations automatically, so the manual set-project-annotations call this
// file used to make is redundant — the test runner itself said it can be
// removed. The file stays because vitest.config.ts lists it in the storybook
// project's `setupFiles`.
//
// CAUTION: do not mention the removed API by its camelCase name anywhere in
// this file (not even in a comment) — the addon decides whether to auto-apply
// annotations by TEXT-SEARCHING this file for that identifier, and a stray
// mention silently disables the auto-application, failing every story test
// with "context.renderToCanvas is not a function".
export {};
