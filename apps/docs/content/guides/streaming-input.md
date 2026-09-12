# Streaming input

React and Vue accept the complete current Markdown string on every update. Your application receives and decodes transport data, accumulates the source, and tells the renderer whether the producer is still running.

## Use one renderer per message

For an ordinary chat answer, start with an empty string and append decoded text to application state. Pass that accumulated string as `content`. A network packet can end inside a word, code fence or formula; it is not a new Markdown component.

| Term               | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| Transport delta    | Newly received text after your transport has decoded and framed it  |
| Accumulated source | All text received for the current message; the renderer's `content` |
| Visible prefix     | The portion currently displayed when smooth reveal is enabled       |
| Markdown unit      | One independently parsed renderer; usually the entire message       |
| Logical document   | One or more Markdown units that intentionally share references      |

The renderer does not implement Fetch, SSE framing, UTF-8 decoding, cancellation or retries. In particular, a Fetch reader's byte chunks are not necessarily complete SSE events. The [React chat recipe](streaming-chat-example.md) includes transport framing and cancellation.

## Separate producer state from displayed state

`streaming` describes whether the producer is active. Incremental parsing is controlled separately by `incrementalParse`, which defaults to `true` in both adapters on the client.

The base renderer displays the current source directly. A smooth renderer can still have text to reveal after the producer finishes. Its rendered streaming state remains active until that backlog drains. Drive your transport's completion state from the transport; drive a custom reveal UI from the smooth hook or composable's returned state.

Smooth rendering shows initial content immediately, including server output and remounts. Later appends can animate; replacements snap to the new source. Mount a new message empty if its future appends should reveal progressively. Do not expect mounting an already completed answer to replay it.

## Finish, cancel and start again

On completion, set the input `streaming` state to `false`. On cancellation, abort your transport and stop further updates, then clear that state. Already received text can still drain through a smooth renderer. Decide in application code whether cancellation should retain or discard that text.

Replacing `content` is supported. When a new message also needs a fresh coordinated turn, give it a new component registration; a coordinator's completion is sticky within the current registration lifetime. See [documents and references](documents-and-references.md).

## Choose the framework recipe

- **React:** [end-to-end chat](streaming-chat-example.md), [smooth rendering](smooth-streaming.md), [cursor](streaming-cursor.md).
- **Vue:** [streaming and composables](vue-streaming.md).
- **Mantine:** [smooth streaming](../../../../packages/react-mantine/README.md#smooth-streaming) and [code display cadence](../../../../packages/react-mantine/README.md#streaming-code-source-display-and-asynchronous-work).

Use a cursor component or slot instead of appending a cursor character to the Markdown source. This keeps the indicator out of parsing, copying and saved content.
