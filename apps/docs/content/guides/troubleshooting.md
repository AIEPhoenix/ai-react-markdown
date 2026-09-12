# Troubleshooting

Start with the symptom below, then follow the linked framework or policy guide. Keep the complete source, package versions and configuration together when reducing a reproduction.

## Markdown or math has no styling

Check the stylesheet for your adapter. React uses its typography CSS; Vue uses `styles.css`; Mantine requires its own stylesheet after the Mantine styles. KaTeX CSS is separate. The [quick starts](getting-started.md) include exact imports and peers. Importing React's CSS does not configure Vue or Mantine presentation.

## Text is still appearing after the response finished

The transport may have finished while smooth reveal still has queued text. Input `streaming` represents the producer; the smooth hook/composable's returned state remains active while the visible text drains. See [Streaming input](streaming-input.md), [React smooth rendering](smooth-streaming.md), or [Vue streaming](vue-streaming.md).

For cancellation, abort the transport as well as clearing producer state. Clearing `streaming` alone does not cancel network requests or discard received content.

## A reference stays literal or a footnote is missing

First try one renderer with the complete logical document. If the layout requires multiple sections, check the matching framework's `AIMarkdownDocuments`, a shared explicit document ID, stable component keys and intended ordering. React additionally requires `blockMemo` to stay enabled. The registry cannot join a fence or other syntax construct split between components.

Server output uses local references; mounted contributions resolve cross-section definitions later. Unreferenced definitions also follow the configured orphan policy. See [Documents and references](documents-and-references.md).

## A link or image URL disappears

The sanitizer may reject the protocol before `urlTransform` runs, or the final transform may reject it afterward. Broadening one stage does not automatically broaden the other. Use [URL policy](url-sanitization.md) and apply policy to URLs emitted by custom components too.

## The streaming cursor is hidden

The measured cursor hides for unsupported tails such as code, math and images, or an invisible definition whose rendered text is elsewhere. It does not attach to an earlier paragraph to create the appearance of progress. React requires an explicit cursor component; Vue enables its cursor by default. Check [React cursor](streaming-cursor.md) or [Vue cursor behavior](../reference/vue.md#cursor-behavior).

## Server HTML and hydration differ

Compare the initial source, identity and configuration on both sides. Keep browser-only measurements out of render. Cross-section references cannot be assumed resolved in server HTML. Follow [React SSR](react-ssr.md) or [Vue SSR](vue-ssr.md); a specific host framework may need additional integration work.

## Long streamed documents slow down

Measure the stage that is growing: full-string preprocessors, an unfinished parse tail, framework conversion, highlighting, diagram rendering or layout. Incremental parsing does not make every update proportional only to new characters. See [Rendering and performance](rendering-and-performance.md) and [Mantine's code lifecycle](mantine-code-blocks.md#streaming-code-source-display-and-asynchronous-work).

## Deep HTML appears as plain text

An engine `EngineRawHtmlDepthError` triggers a specific plain-text fallback for that frame; the next frame attempts normal parsing. Arbitrary plugin or handler errors are not covered by this exception and can still propagate. See [Core error contracts](api/core-engine-contracts.md#core-factories-and-lifecycles).

## A Vue smooth wrapper stops reacting

Pass a live getter to the composable and read current `.value` values inside it. Do not capture a one-time object containing the original source. Returned fields are computed refs; read `.value` in render functions or expose top-level refs for template unwrapping. The [Vue wrapper example](vue-streaming.md#build-a-custom-wrapper-with-a-live-getter) shows the complete pattern.
