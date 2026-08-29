/**
 * Side-effect CSS imports.
 *
 * The apps import stylesheets exactly as the package READMEs tell a user to,
 * and TypeScript has no declaration for them. Vite resolves them at build
 * time; this tells `tsc --noEmit` they exist.
 *
 * Declared here rather than skipped with `// @ts-expect-error`, because these
 * imports are part of the integration under test: if a package stops shipping
 * one of its documented stylesheet entry points, the README is wrong and the
 * typecheck of these apps is the cheapest place to find out.
 */
declare module '*.css';
