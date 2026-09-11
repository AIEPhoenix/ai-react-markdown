# Vue prototype archive

The private lifecycle experiment has graduated into [`@ai-markdown/vue`](../../packages/vue/README.md). Its lifecycle tests now run with the adapter in `packages/vue/src/useMarkdownChunk.test.ts`; the production composable is maintained there as well.

The original experiment covered mounted contribution timing, definition updates, document switching, registry cleanup and one-shot SSR preparation. The current adapter additionally provides VNode conversion, real browser hydration, URL policy, components/slots, smooth turn-taking and measured cursor layout. See the [API review](https://ai-markdown.github.io/docs/guides/api/core-engine-contracts/) for the shared contracts validated by that integration.

This directory retains this historical pointer only. It is no longer a workspace package or a second implementation to maintain. Vue first publication remains pending; refer to the adapter README for current release status and requirements.
