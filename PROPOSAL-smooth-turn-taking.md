# Turn-Taking Gate: Document-Level Smooth-Stream Coordination

**Status: FINAL** — approved by the owner on 2026-08-06 after two oracle review
rounds (both GO-WITH-CHANGES; every finding is incorporated below). All decision
points are resolved (§5). Implementation targets **v2.2.0** (minor). This
document is self-contained: implement from it without the design conversation.

Revision history: rev 2 incorporated oracle round 1 (controller `hold` state
deleted, pass-through rule, sticky `done`); rev 3 switched to a standalone hook
(`useDocumentSmoothStream`); rev 4 consistency sweep; rev 5 incorporated oracle
round 2 (render-time gate decision, progress-heartbeat warning, commit-separated
handshake, value-derived done reporting); final rev resolved D1/D2/D3 and was
rewritten in English; post-implementation rev incorporated the implementation
review (withdrawal-release rule + the Implementation ledger, §9).

---

## 1. Problem

When an application renders a document as multiple chunks under
`<AIMarkdownDocuments>` (the tool-call multi-round shape), each
`AIMarkdownSmoothStream` / `useSmoothStream` instance owns an independent
pacing controller. The controllers do not know about each other:

1. Even when every chunk receives a correct per-chunk `streaming` flag, chunk
   N's drain (≤ `drainMs`) overlaps chunk N+1's start — two typewriters and two
   cursors animate at once.
2. A single app-global `streaming` flag is worse: non-final chunks never reveal
   their trailing grapheme (no `finish()` ever arrives), and every chunk shows
   a cursor.
3. The current documentation can only recommend an application-level
   "smooth first, then split into chunks" workaround.

Target experience: all smooth chunks sharing a `documentId` behave as **one
typewriter** — chunk N reveals completely, then chunk N+1 starts; a single
cursor at any moment.

## 2. Goals and non-goals

**Goals**

- Smooth chunks under one `documentId` that stream from empty reveal
  sequentially; at most one chunk animates and at most one cursor renders at
  any time.
- Near-zero adoption cost: an existing `<AIMarkdownDocuments>` +
  `AIMarkdownSmoothStream` combination gets the correct behavior by default.
- Zero changes to four shipped layers: the incremental-parse engine,
  `documentRegistry`, the smooth `controller`, and `useSmoothStream` (review
  round 1 moved the controller out of the change surface; rev 3 moved the hook
  out as well).
- The manual composition path (`useSmoothStream` spread into a custom wrapper,
  e.g. the mantine package) gains the same capability — the hook result stays
  props-shaped and spreadable into any wrapper; no shell twins.

**Non-goals**

- Coordination across different `documentId` values (multiple ids under one
  wrapper = independent queues, one typewriter each; see §4.6).
- Any behavior change for non-smooth chunks.
- Server-side buffering improvements.
- A document-level "skip all animation" flush (deferred; §4.8).

## 3. Verified constraints (against v2.1.0 code)

**V1 — Registry order exists but is unreachable from the smooth layer.**
`Registry.chunkOrder` (`documentRegistry.ts`) is a public read-only mount-order
symbol list. However, `ChunkSymbolContext.Provider` sits **inside**
`MarkdownContent` (the chunk symbol is allocated in the chunk's own allocate
effect from its `useId`), while the smooth shell and hook run **above**
`<AIMarkdown>`. The smooth layer cannot read chunk symbols; contributing smooth
state into `documentRegistry` would invert the layering. Hence the design
builds a separate coordinator and reuses only the registry's _patterns_.

**V2 — The controller needs no `hold` state.** An early draft added one, on the
premise that "if the hook withholds updates until release, the first `update()`
at release triggers the first-update snap". The premise is wrong: the hook's
useState initializer calls `snap(content)` at construction
(`useSmoothStream.ts:87`), so the "first update" is consumed at mount. A chunk
gated at mount with empty content has controller source `''`; at release,
`update(full)` takes the append branch (`full.startsWith('')`) and animates
normally. Moreover, a controller-level hold would let a queued `finish()` stamp
`drainDeadlineAt` while held; queue time almost always exceeds `drainMs`, so
release would find an expired deadline and flash the entire chunk — failing
exactly the main scenario (source finished while queued). **Conclusion:
buffering lives in a wrapper hook; controller and `useSmoothStream` stay
untouched; the shipped smooth-layer invariants gain no exceptions.**

**V3 — `documentId` reaches the shell via props only.** The id is resolved by
an internal provider inside `AIMarkdown`; public consumers supply it per-chunk
as a prop. The shell can therefore read `documentId` from its own props.
Mirroring `useDocumentRegistry`, coordination engages only for an explicit
`documentId`.

## 4. Design

### 4.1 SmoothCoordinator

```
AIMarkdownDocuments
 └─ SmoothCoordinatorContext.Provider   (new; sibling of the registry context)
     getCoordinator(documentId) → {
       order: reactId[]                  // mount order
       states: Map<reactId, 'pending' | 'done'>  // "revealing" is derived
                                         // (registered ∧ released ∧ ¬done), never stored
       lastProgressAt: Map<reactId, timestamp>   // heartbeat; written without
                                         // version bump / fanout (§4.6)
       version / subscribe()             // microtask-coalesced fanout
       register(reactId) / release(reactId)      // refcount + deferred reclaim
     }
```

One coordinator per `documentId`, held in a `Map<documentId, coordinator>`
inside the Documents wrapper — the same shape as the registry map. Reused
registry patterns, copied not shared:

- `useId`-keyed identity with refcount + microtask-deferred release
  (StrictMode-safe).
- Monotonic `version` + microtask-coalesced subscriber fanout.
- Container eviction via `onEmpty` **including the identity check**: the
  registry fires `onEmpty` from the release microtask once no chunks remain
  (empty-state gate, `documentRegistry.ts:256`), and the container's callback
  evicts the map entry only if it is still the instance it was created for
  (the `=== created` closure check in `AIMarkdownDocuments.tsx`'s
  `getRegistry`; the coordinator's twin sits in `getCoordinator`) — a freshly
  re-created coordinator under the same `documentId` must not be evicted by a
  stale cleanup microtask. Without this pair, long-lived SPAs leak one empty
  shell per retired `documentId`.

Consequences that fall out of a smooth-layer-owned coordinator:

- Non-smooth chunks never register, so they never block successors.
- Unmounting removes a chunk from the queue, so "an unregistered predecessor
  counts as done" holds by construction (no virtualization deadlock).
- `Registry`'s public surface, the engine, the controller, and
  `useSmoothStream` are all untouched.

### 4.2 Public surface: `useDocumentSmoothStream`

A new hook wrapping an **unchanged** `useSmoothStream`:

```ts
useDocumentSmoothStream({
  documentId?: string,
  ...UseSmoothStreamOptions   // content, streaming, pacing, onDrained, now, schedule
}): { content: string; streaming: boolean; flush: () => void }
```

- The wrapper registers with the coordinator, computes the gate state, then
  feeds either `''`/`false` (pending) or the real `content`/`streaming`
  (released or pass-through) into the inner `useSmoothStream` — called
  unconditionally exactly once, so the rules of hooks are trivially satisfied.
  While pending, the inner reaction effect does not run beyond its mount run
  (which feeds `snap('')`, harmless) — its deps stay unchanged; only the inner
  every-render sync effect (onDrained ref + liveOptions write) runs, which is
  negligible.
- **Naming**: singular, matching the family grammar — plural names the
  multi-document container (`AIMarkdownDocuments` holds `Map<documentId, …>`),
  singular names a per-document accessor (`useDocumentRegistry(documentId)`).
  This hook registers one chunk with one documentId's coordinator.
- **Degradation**: without a `documentId`, or outside `<AIMarkdownDocuments>`,
  behavior is byte-identical to `useSmoothStream`. Three implementation
  requirements make the claim real:
  1. Forward the `@internal` `now`/`schedule` seams (the hook's deterministic
     tests are unimplementable otherwise).
  2. Return the inner hook's `flush` **by reference** (a per-render closure
     would break its documented identity stability).
  3. Pass `onDrained` through unwrapped (done detection is value-derived,
     §4.5 — no callback interception).
- **Shell**: `AIMarkdownSmoothStream` always calls `useDocumentSmoothStream`,
  passing its own `documentId` prop. New shell prop
  `smoothCoordination?: boolean`; `false` withholds `documentId` from the hook
  (it still flows to `<AIMarkdown>` for registry coordination). There is no
  `| false` union anywhere in the hook's types — opting out of the hook path
  means not giving it a `documentId` (or using plain `useSmoothStream`).
- **Stability requirement**: `documentId` must be mount-stable. Both the gate
  decision (§4.3) and registration assume it; changing it mid-life is
  undefined behavior. Document this.
- **Known footgun (document it)**: on the manual path the same `documentId`
  must be written twice — hook option and wrapper prop — and the hook cannot
  cross-check them. A mismatch silently loses coordination.

### 4.3 Gating rules

- **Pass-through rule (critical)**: if `content` is non-empty at the **first
  mount render**, the chunk never enters pending — it behaves exactly as
  v2.1.0 (the construction-time snap presents it). Only chunks that mount with
  empty content queue. The decision MUST be captured in the wrapper's own
  useState initializer (render time, before any effect). Deciding at
  registration (effect) time re-opens the holes this rule seals: the first
  client render — and the entire server render — happens before effects, so a
  non-empty chunk would feed `''` to the inner hook (constructed via
  `snap('')`), producing a hydration mismatch and a one-frame collapse.
  Registration itself (queue membership, done reporting) stays effect-time.
  The rule seals three holes at once:
  - first-frame flash-then-blank on non-empty mounts;
  - mid-stream full-page remount (reconnect; virtualization scroll-back while
    the app still says `streaming=true`) mass-replaying the whole conversation
    sequentially — v2.1.0 presents it instantly via the first snap;
  - SSR: `getServerSnapshot = () => content` renders full text on the server;
    a pending first client frame would collapse it to `''`.
    Residual cost: a chunk that mounts with full preloaded content but
    `streaming=true` does not get a typewriter — identical to v2.1.0's existing
    first-update-snaps semantics; accepted.
- **Pass-through exempts only the chunk itself.** A pass-through chunk still
  registers, still reports done (`streaming === false` ∧ drained), and
  empty-mount successors still queue behind it — e.g. a chunk that arrives
  after a mid-stream remount correctly waits for the still-revealing
  pass-through chunks before it.
- **Done predicate**: `done` = user-side `streaming === false` **and** the
  reveal is drained. Drained alone is insufficient — a momentary catch-up
  while the source still streams is not completion.
- **`done` is a sticky latch**: once done, never retracted. A predecessor that
  un-finishes (update after finish — the controller's documented
  finish-re-entrancy, which tool-call multi-round streams rely on to reuse one
  controller) never re-gates anyone; hiding already-visible successor text is
  unacceptable. Accepted cost: a round-2 continuation may overlap a
  successor's animation. Documented. Done reporting is idempotent (repeat
  reports do not bump `version`).
- **Release predicate**: every registered chunk earlier in `order` is `done`.
  Unregistered chunks (non-smooth, unmounted, opted out) never block.
- **Withdrawal releases (implementation-review finding)**: if a gated chunk's
  coordinator becomes `null` mid-life — `smoothCoordination` or
  `smoothTurnTaking` flipped false, the documented escape hatch for a wedged
  queue — the chunk releases unconditionally and stickily (no forced beat:
  with no queue to protect, the plain snap/update degradation is what
  "coordination off" means). Without this rule the escape hatch permanently
  blanks the chunk instead of freeing it. Sticky, so re-enabling
  coordination can never re-hide visible text.
- **Pending presentation**: the wrapper returns `content: ''`,
  `streaming: false` (the inner hook receives exactly that, so its formula
  `streaming || visible.length < content.length` yields `false` without
  overrides). Nothing renders; no cursor; the single-cursor invariant holds.
- **Catch-up after release** (resolved D1): the backlog enters the controller
  as one large append and the existing laws take over. Main scenario (source
  finished while queued): beat-2 `finish()` stamps the drain deadline one
  commit after playback starts, so the reveal is governed by the **drain
  regime** — `rate = remaining / time-to-deadline`, hard-bounded by `drainMs`
  (240 ms balanced / 320 smooth / 150 responsive) regardless of backlog size.
  A fast but continuous pour, not a flash and not per-char grinding.
  Live-at-release: the pre-stats law (`backlog / correctionTauMs`) converges in
  a few hundred ms, then the adaptive law tracks the live tail. EMA safety is
  verified: the release burst's first `recordArrival` only seeds
  `lastArrivalAt` (first-sample early return, `controller.ts:298`), so the
  giant append never poisons the rate estimate; subsequent live samples enter
  via the zero-prior α-blend.

### 4.4 Release: the two-beat handshake

The inner hook's reaction effect takes the `snap()` branch when
`streaming === false` and the previous value was also `false`. A gated chunk
whose source finished while queued (the main scenario) would therefore flash
if released directly with the user's `streaming=false`. Release is a two-beat
handshake:

- **Beat 1**: the wrapper forces `streaming=true`; the inner effect runs
  `update(full)` — append branch, animation starts, `prevStreamingRef`
  becomes `true`.
- **Beat 2**: the wrapper passes the user's real value; a `true → false` edge
  runs `update(full); finish()` — the drain deadline is stamped **now**,
  necessarily fresh.

**The two beats MUST be separate commits.** The release signal arrives in the
coordinator's microtask fanout; if the implementation sets `released` and
clears the forced-true flag in the same microtask, React 18/19 batches them
into one render — the inner effect runs once with `(full, false)`,
`prevStreamingRef` still `false`, and takes the snap branch: exactly the flash
the handshake exists to prevent. Therefore: forced-true is state set at
release; it is cleared **only** in a `useEffect` keyed on that flag, which
guarantees beat 2 a separate commit after beat 1's reaction effect has run.

Verified non-issues (traced against the code): StrictMode replay is idempotent
(`update` early-returns on the identical string; `revive` reschedules the
backlog); the user flipping `false → true` between beats simply feeds `true`
at beat 2 (no finish, no stale `prevStreamingRef`); release while the user's
`streaming` is still `true` makes the forced beat a no-op, and the eventual
`true → false` edge runs the normal finish path. The trailing-grapheme
holdback additionally guarantees no premature drained edge between the beats.

### 4.5 Done reporting

Done is **derived from current values in an effect** — never from
notify/`onDrained` edges. The predicate uses only values the wrapper can see
(the inner hook exposes `{content, streaming, flush}`, not the controller,
and this plan forbids changing it):

```ts
// effect deps: [userStreaming, inner.streaming]
const done = userStreaming === false && inner.streaming === false;
```

Equivalence: the inner hook computes `streaming` as
`streamingInput || visible.length < content.length`. Once the handshake has
handed the user's `false` back (beat 2 and later), `streamingInput` is
`false`, so `inner.streaming === false` ⇔ the reveal is drained. During beat 1
the forced `true` keeps `inner.streaming` true — correctly not done. For a
released still-empty chunk, `0 < 0` is false — correctly done.

Why value-derived: a chunk that mounted empty, queued, was released, and whose
content is still `''` with `streaming=false` (a conditional message that never
materialized) produces **zero** controller notifies — beat-1 `update('')` is
the identical-string no-op; beat-2 `finish()` has nothing to push;
`ensureScheduled` no-ops on empty pending. Edge-driven reporting would never
mark it done and every successor would wait forever.

### 4.6 Ordering assumptions and failure modes

- **Mount order = document order** — the same assumption registry footnote
  numbering already makes. Under gating the failure grade is higher: a chunk
  inserted mid-conversation (regenerating message k; inserting at the top of a
  list) lands at the **end** of `order` and queues behind every existing
  chunk — including ones visually below it that are still streaming. The
  symptom is a hole in the middle of the conversation. Phase-1 handling: the
  per-chunk escape hatch (`smoothCoordination={false}` on the shell; plain
  `useSmoothStream` or no `documentId` on the manual path) plus an explicit
  Footguns entry. A real-world regeneration complaint is the trigger for
  adding an explicit `index` option later.
- **Multiple documentIds under one wrapper**: independent queues — chunks of
  `DOC_1` gate among themselves, chunks of `DOC_2` among themselves; if both
  stream concurrently there are two typewriters, one per document. Intended
  semantics: the single-typewriter invariant is scoped to one `documentId`
  (one logical message), and cross-document serialization is a non-goal.
- **Permanent-wait observability**: a predecessor whose `streaming` is never
  flipped false blocks all successors — the symptom reads as data loss, one
  grade worse than the cursor-lingering failure of the same app bug. No
  automatic pressure valve ("no growth for X seconds counts as done" would
  misfire on genuinely slow models). Instead a **dev-only warning** built on a
  **reveal-progress heartbeat**. Mechanism (fully specified — the coordinator
  fanout cannot drive this, because the stuck scenario is exactly the one with
  zero state changes, so a subscription-based check would never be evaluated):
  - The blocker's wrapper stamps `lastProgressAt` on the coordinator on each
    visible-prefix advance. The stamp **does not bump `version` and does not
    fan out** (a per-frame fanout to every chunk would be a performance bug;
    nothing subscribes to it — it is read on demand).
  - A pending wrapper arms a dev-only `setTimeout` (default threshold:
    10 000 ms) when it enters pending. On fire it reads the earliest non-done
    blocker's `lastProgressAt` directly from the coordinator: progress within
    the threshold ⇒ re-arm silently; no progress ⇒ `console.warn` naming the
    blocker ("a predecessor chunk may have a stuck `streaming` flag"). Cleared
    on release/unmount. Tests drive it with the injected clock/scheduler.
    The predicate MUST NOT be "blocker is drained but streaming is still true" —
    under the trailing-grapheme holdback a live source never reaches
    `isDrained()` (the last grapheme sits in `tentativeEnd` until
    `finish()`/`flush()`), so that predicate is unsatisfiable in the very
    scenario the warning exists for. The heartbeat distinguishes "slow model
    still emitting" (progress → no warn) from "fully arrived, flag stuck" (no
    progress → warn). Production escape hatch: the opt-out.
- **Virtualization** (resolved D3 — non-problem): scroll-back remount of a
  partially-revealed chunk lands in pass-through (content non-empty), snaps
  the accumulated prefix instantly, and the live tail continues animating —
  correct UX; replaying off-screen history would be wrong. A queued
  never-revealed chunk that was recycled and scrolls back with content also
  snaps via pass-through: equally correct (pending chunks render nothing, so
  off-screen ordering is meaningless — the turn-taking invariant is visual).
  No persistent "was revealed" flag; no user-supplied keys. Docs present
  snap-on-scroll-back as expected behavior. Accepted transient: recycling the
  chunk that is _currently animating_ releases its successors (unmount = exit
  queue); scrolling back then shows its tail and the successor animating
  together briefly. Footguns advise pinning the actively-streaming item in
  virtualized lists.

### 4.7 Interaction with the def registry (accepted behaviors, not gaps)

- An empty-content chunk still runs `registerChunk`
  (`MarkdownContent.tsx:259`) and occupies `chunkOrder`; if the gated chunk is
  the last chunk, the aggregate footnote footer still renders inside it
  (`aggregateFootnotesIfLast` keys on `order[last]`) — predecessors' footnote
  defs appear in a chunk whose own text is not yet visible.
- A gated chunk contributes no defs until released: references in earlier
  visible chunks that point into it render as orphans first and resolve after
  release.
- Both match the existing "text hasn't streamed in yet" semantics. Content-
  level gating is the correct layer: "feed everything, hide visually" would
  require decoupling def contribution from rendered content (an engine
  change), and CSS hiding cannot produce a typewriter.

### 4.8 Contract changes

- `onSmoothDrained` / `onDrained` timing: from "within `drainMs` of stream
  end" to "after release and drain" — potentially long after stream end.
  Update JSDoc and docs.
- **Content replacement while pending fires `onDrained`**: the inner hook only
  ever sees `''` → final text; a regeneration that happened while queued is
  invisible to it (`full.startsWith('')` is always true), so the drain edge
  fires. This deviates from the documented "replacement does not fire it"
  contract. Behaviorally defensible (the finally-revealed message did
  complete), but it is a contract deviation — document it explicitly.
- `flush()` while pending is a no-op (the controller is empty; nothing is
  playing). "Skip the whole document" is a document-level capability,
  deferred; document and pin with a test.

## 5. Resolved decisions

- **D1 — Catch-up after release: (a) existing control laws** (owner,
  2026-08-06). No new mechanism, no new knob: the release backlog is one large
  append; the drain regime bounds the main scenario by `drainMs` and the
  pre-stats law covers live-at-release (§4.3). Rejected: snapping the backlog
  (flash defeats the feature); replaying at source cadence (deep queues
  snowball). The only unbounded component of queue wait is the predecessor's
  own source-generation time, which is the definition of turn-taking, not a
  control-law cost. Worst-case added latency ≈ one `drainMs` window per queued
  finished predecessor (~0.3 s each on balanced).
- **D2 — Default: (a) ON under Documents, with opt-out** (finalized with the
  plan). `<AIMarkdownDocuments smoothTurnTaking={false}>` disables
  coordination wholesale. Rationale: the uncoordinated combination is a
  documented footgun with no legitimate dependents; the pass-through rule
  shrinks default-ON's blast radius to chunks that genuinely stream from
  empty — reloads, hydration, and scroll-backs all pass through. Announced in
  the 2.2.0 release notes.
- **D3 — Persistent "was revealed" flag: not built** (owner, 2026-08-06 —
  non-problem). See §4.6 Virtualization. The only behavior the flag could buy
  (re-queueing a scrolled-back chunk for a typewriter replay) is behavior
  nobody wants, at the cost of user-supplied cross-unmount keys.

## 6. Alternative considered: smooth-then-split helper

Fold the current documented workaround into the library: the app feeds the
whole concatenated stream to a **single** controller; a helper slices the
paced prefix at chunk boundaries; slices render as plain `<AIMarkdown>` (no
per-chunk smoothing). Single controller ⇒ single typewriter by construction;
no gate, no state machine. Rejected as the primary because it forces an
application data-flow rewrite (the app must own the concatenated stream and
split points — in the tool-call shape chunks arrive as separate messages) and
inverts the component model ("slice upstream, distribute down"). Positioned as
a **complement**, not part of this milestone; revisit on demand as a small
framework-free utility.

## 7. Test plan

- **Coordinator unit tests**: registration order; sticky done (un-finish
  neither retracts nor re-gates); idempotent reporting; **a released
  still-empty chunk reports done (value-derived; zero notifies must not wedge
  the queue)**; unmount releases successors; opt-out never blocks; refcount
  deferred reclaim; fanout coalescing; onEmpty eviction with the identity
  check; progress-heartbeat warning (progress ⇒ silent, no progress ⇒ warns).
- **`useDocumentSmoothStream` tests**: non-empty **first-render** pass-through
  (hydration, static, and remount shapes — assert the inner hook is
  constructed with the full content, not `''`); pending presentation
  (`content=''`, `streaming=false`, no cursor); post-release append-branch
  animation (no snap); **released with source already finished → two-beat
  handshake animates rather than snaps, deadline fresh, main-scenario drain
  pinned to the `drainMs` bound** — driven through the real coordinator
  microtask release path (two manually separated `act()` blocks cannot catch
  batching collapse); pending `flush()` no-op and `flush` identity stability;
  replacement-while-pending fires `onDrained` per the new contract; drained
  latch never misfires under gating; without `documentId` / outside Documents,
  behavior byte-identical to `useSmoothStream` (including `now`/`schedule`
  forwarding); StrictMode replay. The existing 27 controller tests and the
  `useSmoothStream` suite stay **unchanged** — the regression evidence that
  the shipped layers were not touched.
- **Storybook**: TurnTaking (three chunks streaming in sequence; convergent
  assertion: when N+1's first glyph appears, N is complete); multi-round
  continuation overlap (sticky done); dual-documentId parallel streams (queues
  independent, one cursor each); virtualization scroll-away/scroll-back.
- **SSR**: `renderToString` byte-equality preserved (the pass-through rule
  keeps hydration out of pending).
- Engine and controller untouched ⇒ the full soak gate is not triggered;
  `pnpm preflight` suffices.

## 8. Deliverables

- New files: `components/smoothStream/coordinator.ts`,
  `components/smoothStream/useDocumentSmoothStream.ts`; a sibling Provider
  inside `AIMarkdownDocuments`. `useSmoothStream` and `controller.ts`
  untouched.
- Public API additions: `useDocumentSmoothStream`;
  `AIMarkdownDocumentsProps.smoothTurnTaking?: boolean` (default `true`);
  shell prop `smoothCoordination?: boolean` (default `true`; `false` withholds
  `documentId` from the coordination hook). The three pacing presets and
  `SMOOTH_STREAM_PACING_PRESETS` are untouched.
- Version: **2.2.0** (minor). Docs: rewrite the multi-chunk section of
  `docs/smooth-streaming.md`; update Footguns (mid-conversation insertion,
  documentId double-write, multi-round overlap, dev warning semantics,
  pin-the-streaming-item advice for virtualization); downgrade the existing
  "Documents + smooth overlap" footgun to "solved by turn-taking; limits
  above".
- Estimated effort: Medium (1–2 days: coordinator + hook + shell wiring +
  tests/stories + docs).

## 9. Implementation ledger (post-review, 2026-08-06)

Decisions made or accepted during implementation and its review; all judged
sound by the implementation-review round:

- `coordinator.isReleased(unregisteredId)` treats an unregistered id as
  sitting AFTER every registered chunk (a pre-registration query must not
  release early). Defensive only — real queries always follow registration.
- The done-report effect guards on `released` in addition to the §4.5
  formula: a QUEUED chunk whose source completed while gated must not report
  done (it would release its successors ahead of itself). A necessary
  tightening of the plan's formula, pinned indirectly by the TurnTaking
  story (without the guard, chunk 2 reports done while gated and the
  ordering-violation latch trips when chunks 2 and 3 reveal in parallel).
  The value-derived-done invariant itself (§4.5's zero-notify empty chunk)
  is pinned by the EmptyChunkReportsDone story — its distinguishing
  scenario appears in no other test.
- A chunk released while still empty whose content later arrives complete
  with `streaming=false` takes the inner snap path — no animation, no
  `onDrained` — matching v2.1.0 static-content semantics.
- ~~Accepted cosmetic: an empty chunk released with `streaming=false` shows
  one frame of cursor (the forced beat) before beat 2 clears it.~~ FIXED in
  the post-release cleanup: the forced beat is scoped to non-empty backlogs
  (an empty chunk has nothing to protect from the snap branch). Pinned by
  the ghost-cursor latch in the EmptyChunkReportsDone story,
  falsification-verified (an unconditional forced beat turns it red).
- Accepted narrow races (same shape and acceptance as the registry): a
  coordinator-generation swap landing between a chunk's render and its
  registration effect forks the queue (coordination degrades, no deadlock);
  an aborted concurrent render can leak one empty coordinator until the
  wrapper unmounts.
- The dev-only stuck-flag warning uses a real `setTimeout` (not the injected
  scheduler) and does not name the blocker (a `useId` is meaningless to
  users). Post-release cleanup narrowed the untested surface: the
  warn/re-arm/clear judgment now lives in `evaluateGateWarn` (pure,
  unit-tested in node — stale blocker, fresh progress, never-stamped
  blocker, unblocked); only the timer wiring itself remains untested (the
  unit environment is node with no effects, the browser suite has no fake
  timers).
- The ReleaseAnimatesNotSnaps partial latch is fail-closed but
  flake-sensitive (needs ≥1 commit inside the drain window); the
  post-release cleanup widened the window by running that chunk on the
  `smooth` preset (320 ms vs 240 ms).
- Two §7 slivers are implemented but not directly test-mirrored, accepted:
  the degradation byte-equality tests don't thread the `now`/`schedule`
  seams through the wrapper (forwarding is a one-line passthrough), and the
  onEmpty tests cover firing/StrictMode churn but not the container's
  `=== created` identity closure (a verbatim mirror of the registry's
  proven pattern).
