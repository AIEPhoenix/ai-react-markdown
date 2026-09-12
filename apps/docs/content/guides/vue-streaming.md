# Vue streaming

Use reactive application state for the complete Markdown source and producer status. Complete the [Vue setup](getting-started.md#vue-35) first. For transport terminology and cancellation semantics, see [Streaming input](streaming-input.md).

## Render incoming text

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const content = ref('');
const streaming = ref(false);

function start() {
  content.value = '';
  streaming.value = true;
}

function append(decodedText: string) {
  if (streaming.value) content.value += decodedText;
}

function finish() {
  streaming.value = false;
}

// Connect these functions to your transport's start, decoded-text and finish events.
// Abort that transport as well when cancelling; finish() only updates renderer state.
</script>

<template>
  <AIMarkdown :content="content" :streaming="streaming" />
</template>
```

`streaming` controls busy state and cursor presentation. It does not enable incremental parsing; `incrementalParse` already defaults to `true` on the client. Import KaTeX's stylesheet as described in setup when rendering math.

## Smooth the visible output

Replace `AIMarkdown` with `AIMarkdownSmoothStream` to pace future appends:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { AIMarkdownSmoothStream } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const content = ref('');
const streaming = ref(true);
// Append decoded text to content.value; set streaming.value = false when finished.
</script>

<template>
  <AIMarkdownSmoothStream :content="content" :streaming="streaming" pacing="balanced" />
</template>
```

Pacing accepts `smooth`, `balanced` (the component default), or `responsive`. Initial content is shown completely, including SSR and remounts. Future appends animate while streaming; replacements snap. When the source finishes, displayed streaming state remains active until the visible output drains.

The component exposes `flush()` through its template ref. While the producer is live, flush still respects the engine's grapheme hold-back. It is not a signal that the producer has finished.

## Build a custom wrapper with a live getter

Call composables during setup. Pass a getter that reads the current reactive values, not a snapshot object:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown, { useSmoothStream } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const source = ref('');
const producing = ref(true);
const { content, streaming, flush } = useSmoothStream(() => ({
  content: source.value,
  streaming: producing.value,
  pacing: 'responsive',
}));
</script>

<template>
  <AIMarkdown :content="content" :streaming="streaming" />
  <button type="button" @click="flush">Reveal available text</button>
</template>
```

Returned `content` and `streaming` are read-only computed refs. Templates unwrap the top-level refs above; render functions must read `.value`. The composable releases its watcher and controller on unmount.

For a document-aware wrapper, use `useDocumentSmoothStream` with a live getter that also supplies `documentId` and optionally `coordinate`. It adds a computed `pending` ref. See [Vue documents](vue-documents.md) for queue ownership and waiting behavior.

## Customize the cursor

Vue enables its cursor by default while streaming. Disable it with `:streaming-cursor="false"`, or supply a `cursor` slot. The default animation respects reduced motion. Code, math, images and unsupported tails hide the measured cursor instead of anchoring it to an earlier paragraph.

The `waiting` slot belongs to document turn-taking: it appears only inside `AIMarkdownDocuments` when an earlier smooth participant has not finished. A standalone smooth component does not wait for another message.

Explore [Vue examples](storybook:vue/) and the [complete Vue reference](../reference/vue.md#smooth-streaming-and-turn-taking) for the component and composable contracts.
