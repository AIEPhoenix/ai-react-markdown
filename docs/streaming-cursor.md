# Streaming Cursor

`streamingCursor` is a component slot for a visual “still generating” indicator. Core mounts it inside the typography wrapper while `streaming` is true. The exported `AIMarkdownStreamingCursor` positions a small overlay after the final supported text anchor and keeps animating during pauses in delivery.

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';

function StreamingMessage({ content, done }: { content: string; done: boolean }) {
  return (
    <div aria-busy={!done}>
      <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />
    </div>
  );
}
```

Keep `content` equal to the actual accumulated Markdown. The cursor is separate from the parser input, so copying text, extracting code, and incremental append checks receive the original source. The built-in indicator needs no stylesheet import. When streaming ends the slot unmounts; when no supported anchor exists it remains hidden even if streaming is still active.

For a smooth-stream wrapper, the inner streaming flag remains active until the reveal drains. For a response that has not produced its first character, render a waiting placeholder outside the Markdown component.

## Why not append a cursor character?

The obvious approach — `content={content + '▍'}` while streaming — used to be documented here and is now actively harmful:

1. **It defeats incremental parsing on every frame.** The [prefix-freeze engine](./streaming-and-performance.md#incremental-parse-prefix-freeze)'s append gate requires each frame's content to be a pure append of the previous frame's. `c1 + '▍'` → `c1 + delta + '▍'` is never a pure append (the `▍` is removed and re-added), so every frame silently falls back to a full parse.
2. **The character lands inside source-sensitive constructs.** Inside an unclosed `$$` block it breaks the KaTeX parse; inside a streaming mermaid fence it corrupts the diagram source (text-extracting renderers see it).
3. **It invalidates the last block's memo cache every frame**, even when the real content didn't change.

`streamingCursor` avoids all three by construction: the markdown source, the parse pipeline, and the block-memo cache are untouched. The cursor exists purely at the DOM layer.

## How it works

Three layers, mechanics separated from visuals:

1. **The slot** (`streamingCursor?: ComponentType` on `<AIMarkdown>`): core renders the given component after the content — inside the typography wrapper and both context providers — only while `streaming === true`. No props are injected; the slot controls only _when_ and _where_ the component mounts. Like `Typography`, it is compared by identity: **define it at module scope**.

2. **The positioner shell** (`<AIMarkdownStreamingCursor />`): a zero-height overlay that finds the last text node of the rendered content (a whitelist DOM walk), measures its final character with the Range API (surrogate-pair aware, so emoji tails measure correctly), and imperatively translates an absolutely-positioned holder to sit right after it. Repositioning is driven by three pre-paint signals — a MutationObserver on the content root (tokens, tail-block morphs), a ResizeObserver (container reflow), and `document.fonts.ready` (font swap) — so positioning responds to content and geometry changes without routing x/y coordinates through React state. Actual observer and paint timing remains browser-dependent. Pixels move, not DOM nodes: the cursor never enters the text flow, so select-all/copy never picks it up.

3. **The indicator** (the actual visual): swappable via the shell's `indicator` prop, fed by a three-field contract (see [Custom indicators](#custom-indicators)).

### The default indicator

A blinking dot sized to the current line (taller on headings, smaller on body text). After **5 seconds** without content mutations it cross-fades into a two-tone spinner ring — "still alive, but the stream looks stalled" — and springs back to the dot when tokens resume. Implementation notes that matter to integrators:

- Pure CSS animation (opacity/transform only — no layout properties), so it keeps moving during stalls with **zero re-renders**.
- Keyframes are injected once per document into `document.head` (deduped via `useInsertionEffect`); N concurrent streaming messages share one `<style>` tag.
- `aria-hidden="true"` — see [Accessibility](#accessibility).
- Honors `prefers-reduced-motion: reduce`: blink/spin/transitions are disabled; the static dot vs. ring still distinguishes the two states.

## When the cursor hides

Detection is deliberately conservative: if the content tail can't anchor a cursor safely, the cursor hides for those frames and reappears when a text tail returns (the next mutation re-detects). Hiding triggers:

| Tail situation                                                            | Why                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fenced code / inline code (`pre`, `code`)                                 | These are intentionally excluded anchors; a code renderer may own scrolling or replace source text with a different presentation. The overlay itself does not inject text into the code source |
| KaTeX output (`.katex`)                                                   | Position-less generated markup                                                                                                                                                                 |
| SVG (rendered mermaid)                                                    | Not text                                                                                                                                                                                       |
| Raw-HTML-produced unknown elements                                        | Whitelist walk — unknown structure is not entered                                                                                                                                              |
| Void elements (`hr`, `br`, `img` as last node)                            | Nothing to anchor after                                                                                                                                                                        |
| Empty content (before the first token)                                    | No text at all — render your own placeholder next to `<AIMarkdown>` if you need one                                                                                                            |
| Vertical writing modes                                                    | Not supported                                                                                                                                                                                  |
| A streaming link-reference definition (`[label]: …` at the tail)          | Renders nothing — there is no glyph to point at                                                                                                                                                |
| A streaming footnote definition whose footer entry lives in another chunk | Under cross-chunk coordination the aggregate footer belongs to the last chunk; the cursor cannot truthfully point into another chunk's DOM                                                     |

Everything else — paragraphs, headings, list items, table cells, blockquotes, definition lists, inline formatting — anchors normally.

### Definition-aware anchoring (2.2.1+)

The tail is derived from the **mdast**, not by looking backwards through the DOM. When the text being streamed belongs to a footnote definition (`[^n]: the body streams here…`), the cursor follows it into the footer: it anchors inside that footnote's `<li>` in the (local or aggregate) footer, so the blinking glyph sits where the new characters actually appear. Nested definitions resolve to the deepest one on the last-child chain — a definition inside another definition's body renders in its own `<li>`. When the definition ends and prose resumes, the cursor returns to the body.

## Custom indicators

The shell owns detection/positioning; the indicator owns pixels. Swap the visual without re-implementing any mechanics:

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor, type AIMarkdownStreamingIndicatorProps } from '@ai-markdown/react';

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

- `height` / `width` — rendered size of the anchor character, equality-short-circuited: they update when the measured dimensions differ. A different glyph, font, or layout can change them even at the same font size; equality avoids updates when the measurements stay equal.
- **Vertical centering is the indicator's job.** The shell top-aligns its holder to the anchor character's box; an indicator shorter than `height` renders at the top of the line unless it centers itself — e.g. `marginTop: Math.round((height - size) / 2)` for a `size`-tall dot (exactly what the default indicator does). Full-`height` visuals (like the bar in the example above) need nothing.
- `lastMutationAt` — updates once per mutation batch, so a relevant DOM mutation batch can update the indicator. Mutation batches and transport tokens do not have a one-to-one relationship. It's a leaf component, so this is negligible — and it's what lets a plain `useEffect` implement stall timers with no subscription machinery.
- Position (x/y) is **not** in the contract. It changes every token and must land in the same frame as the content change, so the shell applies it imperatively. Indicators never need to know where they are.

## Behavior details

- **RTL**: the anchor side follows the anchor paragraph's computed `direction` — in RTL text the cursor sits to the visual left of the last glyph, growing away from the text. Mixed-direction content anchors per-paragraph.
- **Ancestor `transform: scale`** (entrance animations, zoom wrappers) is compensated; rotation/skew ancestors are not supported (position drifts, self-heals on the next mutation).
- **SSR**: the shell renders only an inert, invisible wrapper on the server — detection needs a real DOM. No hydration mismatch, no visible jump.
- **Chunked mode** (`<AIMarkdownDocuments>`): pass `streamingCursor` only to the actively-appending chunk (typically the last). The slot renders wherever `streaming === true`; setting it on a non-final chunk draws a cursor mid-document at that chunk's tail. Unless a footnote definition is streaming (see definition-aware anchoring above), the detector skips the aggregate footnote footer, so the cursor marks the end of the _body_, not the appendix; a streaming definition whose footer entry is rendered by another chunk hides the cursor for those frames.
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

## Integrating a custom typography wrapper

The shell locates the rendered content through its DOM parent. Preserve a real wrapper around the content and cursor siblings; a Fragment or `display: contents` changes the geometry assumptions even if ordinary Markdown still looks correct. Keep the cursor in the same content scope and avoid placing toolbars after the Markdown where a tail walk could mistake them for document content.

To check positioning, use paragraphs that wrap, a heading-to-paragraph transition, RTL text, a final emoji, an asynchronous font load, and a streaming footnote. Also verify the deliberate hidden states: empty text, a code fence, math, and a final image. A hidden cursor in these states does not imply the request ended; the message's status UI owns that information.

The built-in stall clock measures DOM activity under the content root, not transport health. Use your request state for errors, cancellation, and retries; a five-second spinner cannot distinguish those outcomes.
