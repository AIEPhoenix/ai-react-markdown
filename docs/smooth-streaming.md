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
adds two props: a `smoothPacing` preset and an `onSmoothDrained` callback
(see [API](#api-reference)). Everything else — plugins, custom components,
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

The controller is an adaptive jitter buffer — the same shape as an audio
playout buffer. It continuously estimates the source's arrival rate and
burst interval (exponential moving averages recorded on every append) and
derives a **target buffer**: roughly one burst's worth of text, the
causality floor for smoothing bursts of that period (you cannot bridge a
300 ms gap with less than ~300 ms of buffered text).

- **While streaming** — `rate = sourceRate + (backlog − target) / correctionTau`.
  The feedforward term tracks the source's measured speed, so lag stays
  bounded at any model speed — a fast model doesn't accumulate a growing
  backlog, a slow model isn't outrun. The feedback term steers the backlog
  toward the target: above target it speeds up; below target it slows
  _below_ the source rate on purpose so the buffer refills instead of
  running dry between bursts. A tiny anti-freeze floor keeps visible
  progress whenever anything is pending.
- **After the stream ends** — a deadline is stamped `drainMs` in the
  future, and the rate becomes `remaining backlog / time to deadline`. The
  backlog empties _by_ the deadline — a hard bound, not an asymptotic
  decay — so the message never dribbles on long after the model finished.

The tuning surface is three named presets (`smoothPacing`), a deliberate
echo of audio-plugin buffer settings — perceptual trade-offs resist
meaningful numeric tuning:

| Preset               | Target buffer    | Trade-off                                                            |
| -------------------- | ---------------- | -------------------------------------------------------------------- |
| `smooth`             | ~1.7 bursts      | Almost never runs dry between server flushes; a little extra lag     |
| `balanced` (default) | ~1 burst         | The causality floor: minimal lag that can still bridge a typical gap |
| `responsive`         | ~0.45 of a burst | Lowest lag; accepts an occasional visible pause between bursts       |

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
import { MantineAIMarkdown } from '@ai-react-markdown/mantine';

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
ignored by the base components.)

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

| Prop              | Type                                     | Default      | Description                                                        |
| ----------------- | ---------------------------------------- | ------------ | ------------------------------------------------------------------ |
| `smoothPacing`    | `'smooth' \| 'balanced' \| 'responsive'` | `'balanced'` | Latency-vs-smoothness preset (see the table above); read live      |
| `onSmoothDrained` | `() => void`                             | —            | Fires when the post-stream drain completes — once per stream round |

All other props are forwarded to `<AIMarkdown>` untouched.

### `useSmoothStream(options)`

Options: `content`, `streaming`, `pacing` (the same preset, unprefixed),
and `onDrained`. Returns `{ content, streaming, flush }` where `content` is
the revealed prefix and `streaming` stays `true` until drained.

### Advanced numeric control

`createSmoothStreamController(options)` accepts, besides `pacing`, every
field of `SmoothStreamPacingParams` as a per-field override on top of the
chosen preset: `bufferFactor`, `correctionTauMs`, `emaTauMs`,
`minCharsPerSecond`, and `drainMs`. The preset bundles themselves are
exported as `SMOOTH_STREAM_PACING_PRESETS`. All numbers are sanitized —
NaN or Infinity (e.g. `parseInt` of a missing setting) falls back to the
preset value instead of poisoning the control law. `drainMs` is consumed
when the stream ends (the deadline is stamped at that moment), so changing
it affects the next drain, not one already in progress.

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
- **Stall behavior.** If the source stalls mid-stream, the reveal eases its
  remaining backlog out (decaying toward the anti-freeze floor) and then
  waits; a pause never enters the cadence estimates, so pacing resumes at
  the pre-stall rhythm instead of adapting to the silence. The built-in
  cursor's stall indicator takes over from there, exactly as without
  smoothing.
- **`onSmoothDrained` fires at end-of-stream, once per stream round.** The
  held-back trailing grapheme keeps the reveal one step short of the source
  for as long as the stream is live, so mid-stream catch-ups (during source
  stalls) do _not_ fire it — only the post-`finish` drain does. In a
  multi-round flow (stream → tool call → stream), each round's drain fires
  it once.

## Footguns

### Forgetting to flip `streaming` to `false`

The end-of-stream signal does real work here: it confirms the held-back
final grapheme and starts the timed drain. If `streaming` stays `true`
forever, the last grapheme of the message never reveals and the returned
`streaming` never settles (so the cursor never unmounts). Wire it to the
actual completion event of your transport, not to a heuristic.

### Per-chunk smoothing inside `<AIMarkdownDocuments>`

Coordinated (cross-chunk) mode runs a definition scan over the chunk's
source on every content change. The scan is append-aware and now
incremental in both directions — link/task lists ride a signature probe
without parsing at all, and while a genuine def block streams (a
citation footer) only the live tail is reparsed (measured
~0.8 ms/append on a 12k-char chunk, down from a ~30 ms full reparse).
What remains at per-frame reveal rates is the coordination fanout
itself: a chunk revealing a def body bumps the shared registry version
each frame and wakes sibling chunks. That's bounded and usually fine —
but if you have MANY sibling chunks on screen, prefer smoothing the
message _before_ it enters coordinated chunking (one
`<AIMarkdownSmoothStream>` per message), which is also the shape that
gives you a single cursor and a single typewriter. Standalone usage has
none of this — the scan only runs in coordinated mode.

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
