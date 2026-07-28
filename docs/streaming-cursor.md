# Streaming Cursor

`streamingCursor` renders a "still generating" indicator right after the **last streamed character** — and keeps it visibly alive through token stalls (tool calls, long reasoning pauses, network hiccups), so users can tell "still generating" from "stuck" even when no new content reaches the frontend.

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-react-markdown/core';

function StreamingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />;
}
```

While `streaming === true`, the built-in cursor tracks the tail of the rendered content; when `streaming` flips to `false` it unmounts. That's the entire integration surface — no config flag, no CSS import.

---

## Why not append a cursor character?

The obvious approach — `content={content + '▍'}` while streaming — used to be documented here and is now actively harmful:

1. **It defeats incremental parsing on every frame.** The [prefix-freeze engine](./streaming-and-performance.md#incremental-parse-prefix-freeze)'s append gate requires each frame's content to be a pure append of the previous frame's. `c1 + '▍'` → `c1 + delta + '▍'` is never a pure append (the `▍` is removed and re-added), so every frame silently falls back to a full parse.
2. **The character lands inside source-sensitive constructs.** Inside an unclosed `$$` block it breaks the KaTeX parse; inside a streaming mermaid fence it corrupts the diagram source (text-extracting renderers see it).
3. **It invalidates the last block's memo cache every frame**, even when the real content didn't change.

`streamingCursor` avoids all three by construction: the markdown source, the parse pipeline, and the block-memo cache are untouched. The cursor exists purely at the DOM layer.

## How it works

Three layers, mechanics separated from visuals:

1. **The slot** (`streamingCursor?: ComponentType` on `<AIMarkdown>`): core renders the given component after the content — inside the typography wrapper and both context providers — only while `streaming === true`. No props are injected; the slot controls only _when_ and _where_ the component mounts. Like `Typography`, it is compared by identity: **define it at module scope**.

2. **The positioner shell** (`<AIMarkdownStreamingCursor />`): a zero-height overlay that finds the last text node of the rendered content (a whitelist DOM walk), measures its final character with the Range API (surrogate-pair aware, so emoji tails measure correctly), and imperatively translates an absolutely-positioned holder to sit right after it. Repositioning is driven by three pre-paint signals — a MutationObserver on the content root (tokens, tail-block morphs), a ResizeObserver (container reflow), and `document.fonts.ready` (font swap) — so the cursor moves in the same frame as the content, with no flicker. Pixels move, not DOM nodes: the cursor never enters the text flow, so select-all/copy never picks it up.

3. **The indicator** (the actual visual): swappable via the shell's `indicator` prop, fed by a three-field contract (see [Custom indicators](#custom-indicators)).

### The default indicator

A blinking dot sized to the current line (taller on headings, smaller on body text). After **5 seconds** without content mutations it cross-fades into a two-tone spinner ring — "still alive, but the stream looks stalled" — and springs back to the dot when tokens resume. Implementation notes that matter to integrators:

- Pure CSS animation (opacity/transform only — no layout properties), so it keeps moving during stalls with **zero re-renders**.
- Keyframes are injected once per document into `document.head` (deduped via `useInsertionEffect`); N concurrent streaming messages share one `<style>` tag.
- `aria-hidden="true"` — see [Accessibility](#accessibility).
- Honors `prefers-reduced-motion: reduce`: blink/spin/transitions are disabled; the static dot vs. ring still distinguishes the two states.

## When the cursor hides

Detection is deliberately conservative: if the content tail can't anchor a cursor safely, the cursor hides for those frames and reappears when a text tail returns (the next mutation re-detects). Hiding triggers:

| Tail situation                                 | Why                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fenced code / inline code (`pre`, `code`)      | Text-extracting custom renderers (e.g. mermaid) would be corrupted by injected markup — and an overlay inside a scrolling `pre` can't track reliably |
| KaTeX output (`.katex`)                        | Position-less generated markup                                                                                                                       |
| SVG (rendered mermaid)                         | Not text                                                                                                                                             |
| Raw-HTML-produced unknown elements             | Whitelist walk — unknown structure is not entered                                                                                                    |
| Void elements (`hr`, `br`, `img` as last node) | Nothing to anchor after                                                                                                                              |
| Empty content (before the first token)         | No text at all — render your own placeholder next to `<AIMarkdown>` if you need one                                                                  |
| Vertical writing modes                         | Not supported                                                                                                                                        |

Everything else — paragraphs, headings, list items, table cells, blockquotes, definition lists, inline formatting — anchors normally.

## Custom indicators

The shell owns detection/positioning; the indicator owns pixels. Swap the visual without re-implementing any mechanics:

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor, type AIMarkdownStreamingIndicatorProps } from '@ai-react-markdown/core';

function MyIndicator({ height, width, lastMutationAt }: AIMarkdownStreamingIndicatorProps) {
  // height/width: rendered size (px) of the last character — match the line.
  // lastMutationAt: performance.now() timestamp of the last content change —
  // derive your own stall styling from it if you want one.
  return <span style={{ display: 'block', width: 3, height, backgroundColor: 'currentColor' }} />;
}

// Module scope — both bindings must be referentially stable.
const MyCursor = () => <AIMarkdownStreamingCursor indicator={MyIndicator} />;

<AIMarkdown content={content} streaming={!done} streamingCursor={MyCursor} />;
```

Contract semantics:

- `height` / `width` — rendered size of the anchor character, equality-short-circuited: they only change when the anchor enters a different font-size context (e.g. a heading), so size-only re-renders are rare.
- **Vertical centering is the indicator's job.** The shell top-aligns its holder to the anchor character's box; an indicator shorter than `height` renders at the top of the line unless it centers itself — e.g. `marginTop: Math.round((height - size) / 2)` for a `size`-tall dot (exactly what the default indicator does). Full-`height` visuals (like the bar in the example above) need nothing.
- `lastMutationAt` — updates once per mutation batch, meaning the indicator re-renders once per token. It's a leaf component, so this is negligible — and it's what lets a plain `useEffect` implement stall timers with no subscription machinery.
- Position (x/y) is **not** in the contract. It changes every token and must land in the same frame as the content change, so the shell applies it imperatively. Indicators never need to know where they are.

## Behavior details

- **RTL**: the anchor side follows the anchor paragraph's computed `direction` — in RTL text the cursor sits to the visual left of the last glyph, growing away from the text. Mixed-direction content anchors per-paragraph.
- **Ancestor `transform: scale`** (entrance animations, zoom wrappers) is compensated; rotation/skew ancestors are not supported (position drifts, self-heals on the next mutation).
- **SSR**: the shell renders only an inert, invisible wrapper on the server — detection needs a real DOM. No hydration mismatch, no visible jump.
- **Chunked mode** (`<AIMarkdownDocuments>`): pass `streamingCursor` only to the actively-appending chunk (typically the last). The slot renders wherever `streaming === true`; setting it on a non-final chunk draws a cursor mid-document at that chunk's tail. The detector skips the aggregate footnote footer, so the cursor marks the end of the _body_, not the appendix.
- **Stall clock semantics**: any DOM mutation under the content root (except the cursor's own) counts as activity — a mermaid repaint or a coordinated footer re-render resets the 5 s clock. The signal means "this message is alive", not strictly "new tokens arrived".

### Accessibility

The visual cursor is `aria-hidden` — a blinking glyph is noise to screen readers, and re-announcing on every anchor move would be worse. The "still generating" semantic belongs on your **message container**: set `aria-busy="true"` (or manage a `role="status"` region) while streaming. The library deliberately does not inject live-region behavior into the content tree.

```tsx
<div aria-busy={!done}>
  <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />
</div>
```

## Known boundaries

- **Shadow DOM / iframe hosts**: the default indicator's keyframes live in `document.head`; a shadow root doesn't see them, and a portal into an iframe injects into the _parent_ document. Both cases: use a self-styled custom indicator (the shell itself is style-free and works anywhere).
- **Attribute-only reflow blind spot**: a class/style change that re-wraps text without childList/characterData mutations moves the anchor with no observer callback — the cursor sits at the old spot until the next token (self-healing). `attributes: true` observation is deliberately not enabled.
- **Full-width last line**: the inline cursor takes no layout space; when the last line exactly fills the container, real inline content would wrap but the overlay clamps to the container edge instead. Transient (≤ a few px, a few frames), resolves on the next wrap.

## Footguns

### Inline slot components

```tsx
// ⚠️ New component identity every render — the slot unmounts/remounts each time,
// resetting detection state and the stall clock.
<AIMarkdown streamingCursor={() => <AIMarkdownStreamingCursor indicator={MyIndicator} />} ... />

// ✅ Module scope.
const MyCursor = () => <AIMarkdownStreamingCursor indicator={MyIndicator} />;
<AIMarkdown streamingCursor={MyCursor} ... />
```

### Going back to `content + '▍'` "because it's inline in code blocks"

The character-append hack does render inside code fences (the built-in cursor hides there instead). If that visual matters more to you than parse-pipeline integrity, understand what you're trading: every streaming frame becomes a full parse (incremental parsing permanently gated off), and the character can corrupt math/mermaid sources mid-stream. The hide-on-code behavior is a deliberate trade, not an oversight.

### Expecting a waiting indicator before the first token

Empty content has nothing to anchor to, so the cursor is hidden until the first text arrives. The pre-first-token spinner is one conditional render in your own component — see [Streaming chat: end-to-end](./streaming-chat-example.md) — and by owning it you also control its placement (avatar, message bubble, etc.), which an inline cursor can't do anyway.

### Wrapping the indicator in extra text-flow elements

The indicator renders inside a zero-height, `pointer-events: none` overlay. If your custom indicator renders large content (a label, a toolbar), it will overlay the text below the anchor line — the shell reserves **no** layout space. Keep indicators glyph-sized; anything bigger belongs outside `<AIMarkdown>`.
