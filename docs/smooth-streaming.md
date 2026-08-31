# Smooth Streaming (Typewriter Pacing)

LLM tokens arrive in bursty network chunks — a 40-character clump, a 300 ms
stall, three clumps back-to-back. Rendering each chunk the moment it lands
makes the message jump in visible lurches. Smooth streaming decouples the
_arrival_ cadence from the _reveal_ cadence: the full accumulated source is
fed in as usual, and a controller reveals it as a steadily growing prefix,
grapheme by grapheme, at a rate that tracks the source's measured cadence.

```tsx
import { AIMarkdownSmoothStream, AIMarkdownStreamingCursor } from '@ai-react-markdown/core';

<AIMarkdownSmoothStream
  content={message.markdown}
  streaming={message.pending}
  streamingCursor={AIMarkdownStreamingCursor}
/>;
```

`<AIMarkdownSmoothStream>` accepts the full `<AIMarkdown>` prop surface and
adds three props: a `smoothPacing` preset, an `onSmoothDrained` callback, and
the `smoothCoordination` turn-taking switch (see [API](#api-reference)).
Everything else — plugins, custom components,
sanitization, cross-chunk coordination — behaves identically, because the
shell renders a plain `<AIMarkdown>` with a paced `content` string.

## Why this composes well here

A typewriter reveal multiplies render frequency: instead of one render per
network chunk, the document re-renders up to once per animation frame. Most
markdown renderers pay a full reparse per render, which makes smoothing a
performance trade-off. Here the revealed prefix grows append-only, which is
exactly the incremental-parse engine's fast path — each frame re-tokenizes
only the appended tail, and block-level memoization skips every settled
block.

Honest per-frame accounting: the _parse_ is O(appended tail), the built-in
LaTeX normalizer is append-aware too (frozen-prefix caching, ~20µs/append
on a 15k math-dense stream vs ~2ms for a full run), and coordinated mode's
per-chunk definition scan is incremental as well (probe + frozen prefix).
What remains O(full prefix) per frame is any **user-supplied
`contentPreprocessors`** — they see the whole revealed string every frame,
so keep them cheap or internally append-aware. The residual multi-chunk
consideration is registry fanout — see Footguns.

## How pacing works

The controller runs a **completion-deadline law**: everything on hand
should be on screen by the time the next chunk is expected. It watches the
gaps between arrivals (a small sliding window — every gap enters, pauses
included) and takes a high quantile as the expected delivery interval; two
slow gaps in a row are enough to adapt to a coarser feed.

- **While streaming** — a deadline is stamped one **horizon** after the
  last arrival (`horizon = bufferFactor × expected interval`, plus a few
  frames of slack, capped at the preset's `maxLagMs`), and
  `rate = backlog / time to deadline`. Backlog and remaining time shrink
  together, so the rate is _constant within a period_: a coarse feed
  (proxy-buffered SSE delivering 2-second lumps) reads as an even
  typewriter running about half a period behind — not pour-then-crawl. A
  tiny anti-freeze floor keeps visible progress whenever anything is
  pending.
- **Pauses need no special case.** A gap longer than the lag cap saturates
  the horizon and cannot change any further decision — `maxLagMs` is both
  the max-lag promise and the whole pause story. The cap is pay-per-use: a
  fine-grained stream's horizon tracks its own small cadence and never
  goes near it.
- **After the stream ends** — the deadline window is sized for rate
  continuity: the tail reveals at roughly twice the stream's measured
  throughput, clamped to `[drainMs, 3 × drainMs]`. The backlog empties
  _by_ the deadline — a hard bound, not an asymptotic decay — and the
  ending is brisker than the body, never a pour.

The tuning surface is three named presets (`smoothPacing`), a deliberate
echo of audio-plugin buffer settings — perceptual trade-offs resist
meaningful numeric tuning:

| Preset               | Horizon              | Max lag | Trade-off                                                                  |
| -------------------- | -------------------- | ------- | -------------------------------------------------------------------------- |
| `smooth`             | ~1.7 × the interval  | 3.5 s   | Extra runway between server flushes; the most delivery coarseness absorbed |
| `balanced` (default) | ~1 × the interval    | 2.5 s   | Even pacing for delivery intervals up to ~2.5 s at minimal lag             |
| `responsive`         | ~0.45 × the interval | 0.8 s   | Lowest lag; accepts visible pauses on coarse or bursty delivery            |

Rule of thumb for the smoothing domain: with `balanced` or `smooth`
(bufferFactor ≥ 1), delivery intervals up to the preset's `maxLagMs` play
back fully smoothly, at a steady lag of about half the interval. Coarser
than that, the reveal walks each chunk evenly and then waits — and the
honest fix is flushing the transport more often, not more buffering.

Numeric parameters (buffer factor, time constants, drain budget) live on
`createSmoothStreamController` for advanced hosts — see
`SmoothStreamPacingParams` and the exported `SMOOTH_STREAM_PACING_PRESETS`
bundles. The preset is read live: switching it mid-stream retunes the
reveal without resetting it.

Reveal steps are grapheme clusters (`Intl.Segmenter`): a surrogate pair,
combining sequence, or emoji ZWJ family is revealed atomically, never as a
lone half that would reach the parser as U+FFFD garbage. (In the rare
runtime without `Intl.Segmenter`, a code-point fallback still keeps
surrogate pairs intact, but ZWJ families and combining sequences may reveal
in steps.) The final grapheme of the source is held back until it is
_confirmed_ — by more text arriving behind it, or by the stream ending —
because a trailing emoji sequence may still be growing.

## The `streaming` prop shifts one step

The value you pass describes the **source** stream: `true` while tokens are
still arriving. The inner `<AIMarkdown>` — and therefore the
`streamingCursor` slot and every context consumer — sees `streaming === true`
until the _reveal_ has also drained. The cursor keeps tracking the animated
tail instead of vanishing while text is still appearing. Once the backlog
empties, the inner flag follows yours and `onSmoothDrained` fires.

## Composing with wrappers

The shell is sugar over `useSmoothStream`, whose result is deliberately
props-shaped — spread it into the base component or any wrapper:

```tsx
import { useSmoothStream } from '@ai-react-markdown/core';
import MantineAIMarkdown from '@ai-react-markdown/mantine';

function ChatMessage({ markdown, pending }: { markdown: string; pending: boolean }) {
  const smooth = useSmoothStream({ content: markdown, streaming: pending });
  return <MantineAIMarkdown {...smooth} />;
}
```

The result also carries a stable `flush()` for a "skip animation" affordance:

```tsx
const { flush, ...props } = useSmoothStream({ content, streaming });
return (
  <>
    {props.streaming && <button onClick={flush}>Skip</button>}
    <AIMarkdown {...props} />
  </>
);
```

(Spreading without destructuring `flush` off is also fine — unknown props are
ignored by the base components.) `flush()` keeps the grapheme discipline: while
the stream is still open it reveals everything _confirmed_ and holds the
trailing grapheme exactly as the animation would (a surrogate half or a
growing emoji ZWJ sequence must never reach the parser); the next append or
`streaming={false}` confirms it.

## Multi-chunk documents: turn-taking

Inside `<AIMarkdownDocuments>`, chunks that share a `documentId` and smooth-
stream coordinate automatically (since 2.2.0): chunks that mount with empty
content reveal **in mount order** — chunk N finishes (source ended AND
reveal drained) before chunk N+1 starts. The document reads as one
typewriter with one cursor, even when the sources stream concurrently.

```tsx
<AIMarkdownDocuments>
  <AIMarkdownSmoothStream documentId={id} content={a} streaming={aLive} />
  <AIMarkdownSmoothStream documentId={id} content={b} streaming={bLive} />
</AIMarkdownDocuments>
```

For custom wrappers, `useDocumentSmoothStream` is the hook behind the
shell — `useSmoothStream` plus the gate, same props-shaped result:

```tsx
const smooth = useDocumentSmoothStream({ documentId: id, content, streaming });
return <MantineAIMarkdown {...smooth} documentId={id} />;
```

Behavior notes:

- **Only empty-content mounts queue.** A chunk that mounts with text
  already present (hydration, virtualized scroll-back, mid-stream remount)
  renders instantly — the mount snap — and never blanks out or replays. It
  still holds its queue slot: later empty-mounted chunks wait for it.
- **A gated chunk renders nothing** (no text, no cursor) until its turn;
  its backlog then plays out through the normal drain law — a fast,
  continuous pour bounded by `drainMs`, not a flash and not per-character
  grinding.
- **Completion is sticky.** A finished chunk that streams again (tool-call
  round 2) does not re-gate successors that already started — hiding
  visible text is worse than the brief overlap you get instead.
- **Unmounting releases.** A chunk removed from the tree (virtualized away)
  leaves the queue; successors don't wait for it.
- **Different `documentId`s are independent queues** — two documents
  streaming at once each get their own typewriter. Cross-document
  serialization is intentionally not a thing.
- Opt out per chunk with `smoothCoordination={false}` on the shell (or use
  plain `useSmoothStream` / omit `documentId` on the hook), or wholesale
  with `smoothTurnTaking={false}` on `<AIMarkdownDocuments>`. Flipping
  either off on a chunk that is currently gated releases it immediately —
  and if its source has already ended, the accumulated text appears in one
  frame (a snap, not an animation). That flash is the intended degradation:
  with coordination off there is no queue left to pace against.

## Outside React

The pacing core is `createSmoothStreamController` — a plain object with no
React (or DOM) dependency, exported for non-React hosts and future framework
bindings:

```ts
import { createSmoothStreamController } from '@ai-react-markdown/core';

const controller = createSmoothStreamController({ pacing: 'balanced' });
controller.subscribe(() => render(controller.getVisible()));
socket.on('token', (accumulated) => controller.update(accumulated));
socket.on('done', () => controller.finish());
```

Contract highlights (full JSDoc on the export):

- `update(source)` takes the **full accumulated string**, not a delta —
  idempotent, replay-safe (StrictMode), and framework-neutral. An
  append-extension animates; anything else — including the first call —
  snaps instantly.
- `finish()` is **not terminal**: `update()` afterwards resumes animation.
  Multi-round flows (stream → tool call → stream) keep one controller.
- `snap(source)` / `flush()` jump without animation; `dispose()` cancels the
  scheduled frame.

## API reference

### `<AIMarkdownSmoothStream>` extra props

| Prop                 | Type                                     | Default      | Description                                                         |
| -------------------- | ---------------------------------------- | ------------ | ------------------------------------------------------------------- |
| `smoothPacing`       | `'smooth' \| 'balanced' \| 'responsive'` | `'balanced'` | Latency-vs-smoothness preset (see the table above); read live       |
| `onSmoothDrained`    | `() => void`                             | —            | Fires when the post-stream drain completes — once per stream round  |
| `smoothCoordination` | `boolean`                                | `true`       | Document turn-taking for this chunk; `false` = reveal independently |

All other props are forwarded to `<AIMarkdown>` untouched. The wrapper-side
switch is `smoothTurnTaking` on `<AIMarkdownDocuments>` (default `true`).

### `useSmoothStream(options)`

Options: `content`, `streaming`, `pacing` (the same preset, unprefixed),
and `onDrained`. Returns `{ content, streaming, flush }` where `content` is
the revealed prefix and `streaming` stays `true` until drained.

### `useDocumentSmoothStream(options)`

Everything `useSmoothStream` takes plus `documentId`. With a `documentId`
and an `<AIMarkdownDocuments>` ancestor it joins that document's
turn-taking queue; without either it behaves exactly like
`useSmoothStream`. The `documentId` must match the one the rendered
component receives and must not change while mounted. While gated, the
returned `flush()` is a no-op (there is nothing playing yet), and
`onDrained` fires only after the chunk's turn — potentially long after its
source stream ended.

### Advanced numeric control

`createSmoothStreamController(options)` accepts, besides `pacing`, every
field of `SmoothStreamPacingParams` as a per-field override on top of the
chosen preset: `bufferFactor`, `correctionTauMs`, `minCharsPerSecond`,
`drainMs`, and `maxLagMs`. (`emaTauMs` is still accepted but deprecated
and read by nothing since the v2.10 deadline-law redesign.) The preset
bundles themselves are exported as `SMOOTH_STREAM_PACING_PRESETS`. All
numbers are sanitized — NaN or Infinity (e.g. `parseInt` of a missing
setting) falls back to the preset value instead of poisoning the control
law. `drainMs` is consumed when the stream ends (the deadline is stamped
at that moment), so changing it affects the next drain, not one already in
progress.

## Behavior details

- **Mount snaps.** The first content a controller sees renders in full,
  immediately. This is what makes SSR hydration match (the server renders
  the full text) and keeps virtualized chat lists from replaying the
  typewriter every time a message scrolls back into view. Only content that
  _arrives after mount_ animates.
- **Regeneration snaps.** A `content` value that isn't an append-extension
  of the previous one (user hit "regenerate", an edit rewrote the message)
  renders instantly — replacement is not a stream. It also does not fire
  `onSmoothDrained`: the replaced message was aborted, not completed.
- **Replacement applies one commit late.** The controller syncs to props in
  an effect, so the render that delivers a replaced `content` still shows
  the previous text for that single commit before snapping. Appends don't
  exhibit this (the paced prefix is by definition behind the source); it
  only matters if you interleave regeneration with same-frame screenshots
  or DOM assertions.
- **Stall behavior.** If the source stalls mid-stream, the reveal walks
  its remaining backlog to the current deadline and then waits; the pause
  lands in the far tail of the gap window, where the interval quantile
  ignores it, so pacing resumes at the pre-stall rhythm instead of
  adapting to the silence. The built-in cursor's stall indicator takes
  over from there, exactly as without smoothing.
- **A sudden oversized chunk reveals fast.** The single-frame reveal
  scales with the burst's size: a fine-grained stream hit by one huge
  flush (a proxy dumping its backlog on reconnect) pours that chunk over
  the stream's short horizon rather than stretching it out — the deadline
  law keeps its promise to stay current. Steady streams of any coarseness
  never exhibit this; it is a one-frame event on a pathological delivery.
- **`onSmoothDrained` fires at end-of-stream, once per stream round.** The
  held-back trailing grapheme keeps the reveal one step short of the source
  for as long as the stream is live, so mid-stream catch-ups (during source
  stalls) do _not_ fire it — only the post-`finish` drain does. In a
  multi-round flow (stream → tool call → stream), each round's drain fires
  it once. Under turn-taking a gated chunk drains only after its turn, so
  the callback can fire long after the source ended — and a regeneration
  that happened entirely while gated is invisible to the reveal (it only
  ever saw empty → final), so that drain DOES fire it, unlike a visible
  regeneration.

## Footguns

### Forgetting to flip `streaming` to `false`

The end-of-stream signal does real work here: it confirms the held-back
final grapheme and starts the timed drain. If `streaming` stays `true`
forever, the last grapheme of the message never reveals and the returned
`streaming` never settles (so the cursor never unmounts). Under
turn-taking the failure escalates: every later chunk in the document stays
gated behind the stuck one and **never appears at all** — which reads as
data loss, not as a cosmetic lingering cursor. A dev-build warning fires
when a chunk stays gated behind a predecessor that shows no reveal
progress for ~10 s; in production, wire `streaming` to the actual
completion event of your transport, not to a heuristic.

### Chunks inserted out of mount order

The turn-taking queue is mount-ordered — the same assumption cross-chunk
footnote numbering already makes. A chunk mounted mid-conversation
(regenerating an earlier message, inserting at the top of a list) lands at
the END of the queue and waits for every existing chunk, including ones
visually below it: the symptom is a hole in the middle of the
conversation. Put `smoothCoordination={false}` on chunks you insert out of
order (they reveal independently and don't block anyone).

### `documentId` written twice on the manual path

With `useDocumentSmoothStream` you pass `documentId` to the hook AND to
the rendered component, and the hook cannot cross-check them. If they
drift apart, nothing crashes — the chunk silently stops coordinating (or
coordinates under the wrong document). The shell doesn't have this
problem; it wires its own prop through.

### Recycling the actively-streaming chunk in a virtualized list

Scroll-back itself is safe: a remounted chunk with accumulated text snaps
instantly and continues (no replay, no blanking). But unmounting the chunk
that is _currently revealing_ releases its successors (by design — a
gone chunk must not deadlock the queue), so scrolling back shows its tail
and the successor animating together briefly. If your list virtualizes,
pin the actively-streaming item so it isn't recycled.

### Registry fanout with many sibling chunks

Coordinated (cross-chunk) mode runs a definition scan over the chunk's
source on every content change. The scan is append-aware and incremental
in both directions — link/task lists ride a signature probe without
parsing at all, and while a genuine def block streams (a citation footer)
only the live tail is reparsed (measured ~0.8 ms/append on a 12k-char
chunk, down from a ~30 ms full reparse). What remains at per-frame reveal
rates is the coordination fanout itself: a chunk revealing a def body
bumps the shared registry version each frame and wakes sibling chunks.
Turn-taking already gives you the single-typewriter shape, and gated
chunks contribute nothing while they wait; if you still see fanout cost
with very many mounted siblings, smoothing the message _before_ it enters
coordinated chunking (one paced stream, split downstream) remains the
zero-fanout alternative. Standalone usage has none of this — the scan
only runs in coordinated mode.

### Disabling block-memo while smoothing

`blockMemo={false}` also disables incremental parsing, so the per-frame
reveal degrades into a per-frame **full document reparse** — the one
combination where smoothing is genuinely expensive. Leave block-memo on
(the default) when smoothing is enabled.

### Stacking a second pacing layer

If your transport already throttles or "types" the text (some SDK helpers
do word-by-word reveal), feeding that output into the smooth shell double-
paces the stream: two catch-up controllers fight, and the reveal turns
rubber-bandy. Feed the rawest accumulated string you have and let one layer
own the cadence.

### Reduced-motion users

A typewriter reveal is motion. The library doesn't auto-disable it (the
paced string is ordinary content — there's no CSS to gate), so honor
`prefers-reduced-motion` yourself where it matters: render plain
`<AIMarkdown>` instead of the smooth shell (or don't route through
`useSmoothStream`) when
`matchMedia('(prefers-reduced-motion: reduce)').matches` — the shell
always paces; omitting `smoothPacing` just means the default preset.

### Asserting on wall-clock timing in tests

Pacing is deadline-based over an injectable clock. In unit tests, inject
`now`/`schedule` (the hook accepts both as internal seams; the controller
takes them in options) and advance time manually — racing real timers
against assertions is exactly the flake the seams exist to prevent.
