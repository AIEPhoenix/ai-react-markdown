# Vue documents and references

Use this pattern only when one logical document needs several independently parsed renderers. Read [Documents and references](documents-and-references.md) first; arbitrary network chunks should remain one accumulated source.

## Share definitions across sections

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const sections = ref([
  { id: 'claim', content: 'A claim[^source] and [site][url].' },
  { id: 'sources', content: '[^source]: Shared citation\n\n[url]: https://example.com' },
]);
</script>

<template>
  <AIMarkdownDocuments>
    <AIMarkdown
      v-for="(section, index) in sections"
      :key="section.id"
      :content="section.content"
      document-id="answer-1"
      :document-index="index"
    />
  </AIMarkdownDocuments>
</template>
```

The stable key follows section identity; `documentIndex` follows its current position. Update or remove items in `sections` to update their contributions. Explicit IDs coordinate only inside this provider; another provider with the same ID has a separate document.

A reader may appear before its definition. Mounted contributions provide canonical destinations, global footnote numbering and occurrence IDs. Changing `documentId` releases the previous registration. Unmounting releases contributions and subscriptions.

## Coordinate smooth sections

Inside the same provider, use `AIMarkdownSmoothStream` for each paced section and give the participants the same explicit document ID. `coordinate` defaults to `true`.

- An empty-at-mount section waits for earlier registered smooth sections to finish producing and draining.
- A section mounted with existing content keeps that content visible.
- Smooth turns follow registration order. `documentIndex` orders references, not reveal turns.
- Completion stays sticky within a registration. Use fresh component identities for a new sequence that should queue again.
- `:coordinate="false"` opts out of smooth turn-taking without removing the base renderer's document reference identity.

Provide a `waiting` slot for queued content and a `cursor` slot for the active renderer. The [Vue streaming guide](vue-streaming.md) covers pacing and custom composables.

## Account for server rendering

SSR and initial hydration render local content and local footnotes without publishing contributions. Cross-section definitions become available after mounted contributions commit. Render one complete document through one component when server-only output must contain resolved references.

See [Vue SSR and lifecycle](vue-ssr.md) for the supported boundary and [Vue examples](storybook:vue/) for late definitions, definition replacement, document switching and isolation.
