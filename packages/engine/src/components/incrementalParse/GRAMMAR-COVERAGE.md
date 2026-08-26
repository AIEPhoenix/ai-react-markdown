# Grammar coverage: what the freeze scanner models, and what it does not

`computeFreezeBoundary` decides how much of a streamed markdown prefix can
never be rewritten by a future append. To decide that it has to predict the
output of **two** grammars at once:

- **micromark**, which decides where markdown blocks begin and end, and
- **parse5** (through `rehype-raw`), which re-parses the raw HTML those
  blocks contain and owns the final hast.

Every under-block found so far — v2.5.3 through v2.5.5, all in the
deviation ledger below — has come from a single field standing in for
both grammars at once. The scanner's module doc lists the seven _blockers_
it enforces. This file is the other half: the **source grammars**, entry by
entry, with what the scanner does about each and whether the fuzz corpus can
even reach it.

Read it as a to-do list, not as documentation of a finished thing. A row
that says "not modelled — poisoned instead" is fine. A row that says "not
modelled" with no poison is a bug waiting to be sampled.

## Ground facts this file depends on

| Fact                                                                                                                                                                                                                                                                                               | Where it is pinned                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `rehype-raw` parses in **fragment** mode, never document mode: `documentMode(tree)` needs a `doctype`/`html` node as the tree's first child, and a markdown pipeline never produces one — a `<!DOCTYPE html>` in the source is a `raw` node, not a `doctype` node.                                 | `hast-util-raw@9.1.0/lib/index.js` (`Parser.getFragmentParser(undefined, parseOptions)`)                          |
| The fragment context element is **`<template>`**, so the initial insertion mode is **"in template"** — not "in body". `startTagInTemplate` re-dispatches per tag: head-ish names to "in head", table parts to "in table"/"in row"/"in table body"/"in column group", everything else to "in body". | `parse5@7.3.0/dist/parser/index.js` (`getFragmentParser` → `createElement(TN.TEMPLATE, …)`, `startTagInTemplate`) |
| `scriptingEnabled: false`, so `<noscript>` content is ordinary HTML, not raw text.                                                                                                                                                                                                                 | `hast-util-raw@9.1.0` `parseOptions`; already reflected in `RAW_TEXT_ELEMENTS`                                    |
| The sanitize schema allows neither `svg`/`math` nor their children, and `hast-util-sanitize` LIFTS the children of a disallowed element rather than dropping them. Foreign-content mistakes are therefore mostly invisible in the final hast — but only mostly (see the deviation ledger).         | `sanitizeSchema.ts` (extends `defaultSchema`)                                                                     |

Everything below is stated against those four facts. If any of them changes
— a `rehype-raw` upgrade, a schema that allows `svg` — the "safe" column has
to be re-derived rather than assumed to hold.

## Table A — CommonMark HTML blocks (spec §4.6)

Start conditions are checked at block indent (≤ 3 spaces). "Interrupts" is
whether the type may begin on a paragraph continuation line.

| Type | Start                                                                                  | End                                                                                                               | Interrupts a paragraph | Scanner                                                                                                                                                                                                                                                                                                                         | Corpus marker                                                          |
| ---- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | `<script` / `<pre` / `<style` / `<textarea` + whitespace, `>` or EOL                   | line containing the literal `</script>` / `</pre>` / `</style>` / `</textarea>`; **a blank line does NOT end it** | yes                    | `TYPE1_NAMES`, `TYPE1_START_RE`, `mdBlock` html{1}, `TYPE1_CLOSE_RE` — both halves were wrong until v2.5.3. The member carries `raw`: three of the four names are parse5 raw-text elements, `pre` is not (F13)                                                                                                                  | `rawTextBlock`, `type1Boundary`                                        |
| 2    | `<!--`                                                                                 | line containing `-->`                                                                                             | yes                    | `mdBlock` html{2} (+ `p5Tok` comment — parse5's half, split since P4b-completion)                                                                                                                                                                                                                                               | `unclosedRawOpener`, `overlappingTerminator`                           |
| 3    | `<?`                                                                                   | line containing `?>`                                                                                              | yes                    | `mdBlock` html{3}                                                                                                                                                                                                                                                                                                               | `selfContainedCdataPi`, `overlappingTerminator`                        |
| 4    | `<!` + ASCII letter                                                                    | line containing `>`                                                                                               | yes                    | `mdBlock` html{4}                                                                                                                                                                                                                                                                                                               | `multiLineDecl`                                                        |
| 5    | `<![CDATA[`                                                                            | line containing `]]>`                                                                                             | yes                    | `mdBlock` html{5}                                                                                                                                                                                                                                                                                                               | `multiLineCdata`, `selfContainedCdataPi`                               |
| 6    | `<` or `</` + a name from `htmlBlockNames` (62 entries) + whitespace, `>`, `/>` or EOL | blank line                                                                                                        | yes                    | `TYPE6_NAMES` + `TYPE6_START_RE` → `mdBlock` html{6}                                                                                                                                                                                                                                                                            | `unclosedRawOpener` and most raw-HTML families                         |
| 7    | a complete open or closing tag alone on its line                                       | blank line                                                                                                        | **no**                 | **EXACT** since the exact-type-7 stage: `isType7Line` (micromark's complete-tag automaton, transcribed) + `prevLineOpenContent` (the exact interrupt input). TWO undecidable interrupt classes poison the tag line instead of answering: pipe lines (sticky `tableMaybeOpen`) and container lines (sticky `containerMaybeOpen`) | `closeWithAttrsInParagraph`, `crossLineTagGarbage`, `nonType6QuotedGt` |

Notes the scanner depends on:

- For types 1–5 the terminator's line is part of the block, including the
  bytes AFTER the terminator. Blocker 6 (raw-remnant seam) exists for this.
- Type 7's "cannot interrupt a paragraph" is really "cannot interrupt
  CONTENT" — micromark's paragraph/definition construct, including
  container-held paragraphs. `prevLineOpenContent` derives it exactly per
  line class (measured: type 7 OPENS after headings, thematic breaks,
  setext underlines, table rows, indented code, fence closes, terminator
  lines and bare list markers; it stays REFUSED after paragraph and
  definition lines). CONTAINER lines — blockquote markers, list items,
  footnote definitions — have no decided answer at all: see the exact
  type-7 section below.
  A closing tag with attributes (`</div a="b">`) is not a valid tag, so it
  is neither type 6 nor type 7 — plain paragraph text. That was one of the
  four v2.5.3 families. A closing tag whose NAME is a raw-text name IS
  type 7 (`</style>` alone on a line — the earlier "paragraph as end tags"
  note here was wrong, and harmless only while the retired run flag
  blanket-covered every `<`-starting line), and so is an open raw-text
  name with the self-closing slash straight after it (`<style/>`).

## Table B — parse5 tokenizer states that swallow markup

Inside these states every `<…>` is text until the element's own end tag.
The scanner models them with the `p5Tok` union (`rawText`/`script` kinds,
`openedInline` captured at open) — one partition since P3a, where four
overlapping fields stood before.

| State                       | Elements                                        | Modelled                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCDATA                      | `title`, `textarea`                             | yes                                                                                                                                                                                                                                                                                                      |
| RAWTEXT                     | `style`, `xmp`, `iframe`, `noembed`, `noframes` | yes                                                                                                                                                                                                                                                                                                      |
| RAWTEXT (scripting on only) | `noscript`                                      | correctly EXCLUDED — `scriptingEnabled: false`                                                                                                                                                                                                                                                           |
| SCRIPT_DATA                 | `script`                                        | yes, with the FULL escape ladder since P3b: `escaped` + `double`. While double, `</script>` steps back to escaped and the element stays open AND counted; `-->` exits both levels. The old double-entry poison is retired — the splice refuses the crossing prefixes instead (`rawTextRegionCrossesOut`) |
| PLAINTEXT                   | `plaintext`                                     | yes, and it POISONS: `</plaintext>` is text too, so nothing after it can be modelled                                                                                                                                                                                                                     |

Position matters as much as the name, and this is where the corpus was
thinnest:

| Position                                             | Behaviour                                                                                                                                                                                                       | Corpus                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Block-level run                                      | ordinary type-1/type-6 html block                                                                                                                                                                               | `rawTextElementArb`                                            |
| Opened INLINE in a paragraph, spanning a line ending | parse5 LIFTS the element out of the flow, rewriting the paragraph already frozen                                                                                                                                | `inlineRawTextSpanArb` — added v2.5.3, this was an under-block |
| Inside foreign content                               | **no** tokenizer switch: `<title>` under `<svg>` is a foreign element in the DATA state                                                                                                                         | `foreignContentArb` — added 2026-08-21                         |
| Inside foreign content, breakout or not              | POISONED since P3a (`foreignRawTextSwitchUnknowable`): whether the tokenizer switches is unanswerable to a name-count bag, and both wrong answers shipped bugs (F2 one way, a measured boundary RISE the other) | `foreignContentArb` (direct-switch shapes added with P3a)      |
| As the fragment context element                      | irrelevant here: the context is always `<template>`                                                                                                                                                             | —                                                              |

## Table C — insertion modes that ERASE or MOVE nodes

These are the constructs that break the line model's core assumption — that
a confirmed line only affects itself and what follows.

| Construct                                                                                                    | What parse5 does                                                                                                                               | Scanner                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<!DOCTYPE …>`                                                                                               | fragment mode ignores the token entirely; it emits no node and the text around it MERGES, so the merged node STARTS BEFORE the construct       | `phasePoisonedAt = 0` — whole document (v2.5.3)                                                                                                                                                                                                                                                               |
| `<html>` `<head>` `<body>` `<frameset>` and their end tags                                                   | absorbed into document structure, no node emitted, same retroactive merge                                                                      | `DOCUMENT_STRUCTURE_NAMES` → `phasePoisonedAt = 0` (v2.5.3)                                                                                                                                                                                                                                                   |
| `<base>` `<basefont>` `<bgsound>` `<link>` `<meta>` `<title>` `<style>` `<script>` `<noframes>` `<template>` | "in template" re-dispatches these to **"in head"**                                                                                             | the raw-text ones via `RAW_TEXT_ELEMENTS`, the void ones via `VOID_TAGS`. `<template>` itself is not modelled and does not need to be: its children go into a content fragment that never reaches hast, and the sanitize schema drops the element — swept clean 2026-08-21, pinned by `insertionMode.test.ts` |
| `<caption>` `<colgroup>` `<tbody>` `<tfoot>` `<thead>` `<col>` `<tr>` `<td>` `<th>` outside a table          | re-dispatch to a table mode; subsequent character tokens are **foster-parented** out of the table, so a following GFM table's cells can vanish | `TABLE_PART_NAMES` + `strayTablePart`, suppressed when a `<table>` is open (2026-08-20 B1)                                                                                                                                                                                                                    |
| `</br>`                                                                                                      | synthesized as `<br>`                                                                                                                          | `treeQuirkArb` covers it; balance-wise a void tag                                                                                                                                                                                                                                                             |
| `</p>` with no open `<p>`                                                                                    | synthesizes an empty `<p>`                                                                                                                     | `treeQuirkArb`                                                                                                                                                                                                                                                                                                |
| Breakout start tag inside `<svg>`/`<math>`                                                                   | POPS the foreign root off the stack, then processes the tag as HTML                                                                            | NOT modelled since P3a — the collapse counts every non-root self-closing tag open and poisons raw-text starts near foreign roots, so the pop's effect on the boundary is dominated in the safe direction; the exact model it replaced was the F1/F2/F5 family                                                 |
| Misnested formatting elements ("adoption agency")                                                            | re-parents and clones formatting elements                                                                                                      | not modelled; reached only through unbalanced `<b>`/`<i>`, which block on tag balance anyway                                                                                                                                                                                                                  |

## Table D — constructs that reach across a confirmed blank line

Candidates are emitted at exactly one kind of place: a **confirmed blank
line** (`processConfirmedLine`, the `ln.blank` branch — one candidate per
blank, at `ln.end + 1`; the trailing partial line is never blank, because a
line only counts as blank once its terminating newline exists). The safety
argument for that placement is: _every construct, in either grammar, whose
semantics span a blank line is enumerated here, and each row names the
mechanism that covers it._ This table is that enumeration — the
completeness obligation the placement rule rests on. A construct that
crosses a blank and has no row here is an under-block waiting to be
sampled, exactly like an unpoisoned "not modelled" row in Tables A–C.

Enumeration domain: CommonMark core blocks, plus the syntax-adding
extensions the engine actually enables (`pluginChain.ts`: GFM, math,
definition lists when `defListEnabled`, `==mark==` highlight — the rest of
the chain is mdast transforms with no grammar effect), plus the parse5
fragment grammar. **Adding a syntax extension to the chain means adding
rows here first.**

### D1 — the blank sits INSIDE a block (the block continues past it)

| Construct                                               | Why it crosses                                                                                                                                                       | Mechanism                                                                                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fenced code interior                                    | a blank does not end a fence (§4.5)                                                                                                                                  | `inFence` returns before candidate emission — interiors are candidate-free                                                                                            |
| `$$` flow-math interior                                 | fence-like; blank interior allowed                                                                                                                                   | `inMath`, same early return. Under `mathFlow: false` the extension is off and `$$` is paragraph text — no crossing exists to cover                                    |
| HTML block type 1 interior                              | a blank does NOT end it (§4.6)                                                                                                                                       | `type1FlowOpen` → candidate emitted with `htmlBalanced: false`                                                                                                        |
| HTML block types 2–5 interiors                          | end at `-->` / `?>` / `>` / `]]>`, not at a blank                                                                                                                    | `commentOpen` / `piOpen` / `declOpen` / `cdataOpen` in `htmlBalanced`                                                                                                 |
| Indented code block                                     | blank + ≥4-indent lines merge into one block (§4.4)                                                                                                                  | blocker 3: `classifyBlockStart` indent ≥ 4 → rolling `hazardVerdict`, candidate `hazard`                                                                              |
| List item continuation                                  | blank + indented content extends the item (§5.2)                                                                                                                     | blocker 3: `LIST_MARKER_RE` sets the verdict; only a column-0 non-marker block start clears it                                                                        |
| Footnote definition body (GFM)                          | continuation rule mirrors list items                                                                                                                                 | blocker 3: `FOOTNOTE_DEF_RE`                                                                                                                                          |
| Definition-list `: ` description body                   | continuation rule mirrors list items                                                                                                                                 | blocker 3: `DEF_LIST_DD_RE` (only when `defListEnabled`)                                                                                                              |
| Fence opened at ≥4 indent inside a list item            | the scanner's fence model only opens at 0–3 indent; the real fence still crosses blanks                                                                              | blocker 3 again: indent ≥ 4 is a `hazardVerdict` true on its own, so every candidate under it is rejected                                                             |
| Any UNCLOSED element at the blank (parse5)              | micromark's block ended; parse5's element is still open and swallows what follows — including `<svg>`/foreign roots                                                  | `openTotal !== 0` → `htmlBalanced: false`; accuracy of the count is the `openStack` + scope-barrier walk (F7); foreign self-closing tags are simply counted since P3a |
| RAWTEXT/RCDATA element open across the blank (parse5)   | type-6 ended (micromark) while parse5's raw-text state runs on — grammars disagree about every later byte                                                            | F10: document-wide poison at the blank; type 1 exempt (a blank ends neither grammar — they agree)                                                                     |
| Quoted attribute value still open at the blank (parse5) | micromark ends the block; parse5's tokenizer stays inside the value                                                                                                  | poison at the blank (the `pendingTag.attr` quote check in the blank branch)                                                                                           |
| Bogus comment still open at the blank (parse5)          | same shape when UNPAIRED: block ended, tokenizer did not. With its md type 2-5 block still open the two grammars cross the blank TOGETHER (batch 3 pairs the states) | poison at the blank only when no md 2-5 block is open; aligned state survives the blank                                                                               |
| Stray table-part tag before the blank (parse5)          | re-routes insertion modes so a LATER GFM table's cell text is foster-parented out — the effect lands across any number of blanks                                     | `strayTablePart` poisons candidates from the tag on, suppressed while a real `<table>` is open (B1)                                                                   |
| Suppressed fence/math open inside an html-flow run      | whether the run swallows the opener is container-dependent; if it really opened, the interior crosses blanks with the phase inverted                                 | blocker 7: `phasePoisonedAt` at the suppressed open                                                                                                                   |

### D2 — content AFTER the blank re-parses content BEFORE it

| Construct                                             | Why it reaches back                                                                                                                                                                                                                  | Mechanism                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition-list `: ` term claim                       | the extension scans BACKWARD across exactly one blank to claim the previous paragraph as `<dt>`                                                                                                                                      | blocker 4: `defListSettled` — `blankRun >= 2` is immune, otherwise the NEXT confirmed line must never match `^ {0,3}:[ \t]` (`canBecomeDdLine`) |
| `[label]:` definition retargeting an earlier `[text]` | reference-ness is decided at parse time; the def may sit ANY number of blanks below the ref                                                                                                                                          | blocker 5: `unresolvedRefs` / `earliestUnresolved`; a def only settles once a confirmed blank FOLLOWS it                                        |
| `[^label]:` retargeting an earlier `[^label]`         | same, separate label namespace                                                                                                                                                                                                       | blocker 5, `footnoteDefs`                                                                                                                       |
| Retroactive construct on the unconfirmed TAIL line    | a doctype/structure tag still being typed would poison everything once confirmed                                                                                                                                                     | `tailCarriesRetroactive` suppresses every candidate for the frame, without baking partial-line state                                            |
| Sanitize-erasure text merge (parse5 + sanitize)       | doctype, `<html>`/`<head>`/`<body>`/`<frameset>`, `<template>`, paragraph-inline `<?`/`<!`/`<![CDATA[`/`<!--`: the construct's bytes vanish and the text on either side MERGES into a node that starts BEFORE it — past any boundary | `phasePoisonedAt = 0`, document-wide (Table C rows; F9/F11/F12 — an opener-offset poison measurably did not cover the backward merge)           |
| Floating raw remnant as the last frozen child         | the remnant's hast shape (position vs seam-owned) depends on whether a sibling FOLLOWS it — i.e. on the block after the blank                                                                                                        | blocker 6: `seamRisk` rejects candidates while the remnant is the last frozen child                                                             |

### D3 — cannot cross a blank (the grammar itself closes the case)

No mechanism needed; each row cites the rule that forbids the crossing.

| Construct                        | Rule that stops it at the blank                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setext underline                 | must directly follow paragraph content; a blank ends the paragraph first (§4.3)                                                                                                                                                                        |
| GFM table delimiter row          | must directly follow the header row — a blank between them kills the table                                                                                                                                                                             |
| Definition title on its own line | the title continues the definition only with NO blank between it and the destination                                                                                                                                                                   |
| Lazy paragraph continuation      | lazy lines continue a paragraph; a blank ends the paragraph                                                                                                                                                                                            |
| Blockquote                       | a blank ends it; a later `>` opens a NEW quote (no lazy crossing)                                                                                                                                                                                      |
| HTML block types 6–7             | their END condition IS the blank line (§4.6)                                                                                                                                                                                                           |
| Every inline construct           | emphasis, code spans, autolinks, strikethrough, `==mark==`, inline `$` math all live inside one paragraph, which the blank ends. Cross-LINE code spans inside a paragraph are the masking rule's job (module doc) — intra-paragraph, never cross-blank |

## P3b status — SHIPPED (2026-08-25, all three retirements)

Batch 1 (F6, the double-escape poison): the script kind carries the full
escape ladder (`double` implies `escaped`; `</script>` while double steps
back to escaped with the element OPEN and counted; `-->` exits both
levels — parse5 tokenizer, verified in source). Recovery is
SINGLE-LINE-ONLY, and the release soak decided that: a multi-line tangle
necessarily CROSSES micromark blocks (the type-1 block ends at the first
literal closer line, the element survives it), the element swallows the
later blocks and their wrap separators as its own text, and sanitize
stripping it merges the survivors backward past earlier boundaries — the
F9/F11 erasure class, so the surviving close poisons DOCUMENT-WIDE
(direction-battery seeds 20282605/10/11: boundary 56 with the frozen
region's children changing under a one-character append). A tangle that
resolves on its opening line is one block and one element and recovers.
`rawTextRegionCrossesOut` in `spliceParse.ts` stays as defense in depth
on the splice path (it reproduced the first landing's frame-20 extra
`"\n"` red before it existed).

Batches 2+3 (`--!>`; the `<?`/`<![CDATA[` first-`>` disagreements): both
went WINDOW-EXACT instead of poisoned. parse5 leaves the construct early
(`--!>` closes its comment; the first `>` closes its bogus comment —
which is now honestly PAIRED with md types 3/4/5 on `p5Tok`, rev2 #4);
micromark's block runs to its own terminator. The window between the two
closers poisons ONLY when it can hold bytes parse5 acts on
(`P5_MARKUP_RE`); a markup-free window is parse5 TEXT inside micromark's
block — the grammars converge at the terminator, and the text remnant is
owned by the blocker-6 seam (`floatingResidue` takes the INTERSECTION of
the two comment states, rev2 #5). An md 2-5 block still open at a blank
carries its aligned bogus state across; the unpaired-bogus blank poison
fires only without the md construct. Batteries:
`scriptDataEscape.test.ts`, `commentWindowRecovery.test.ts`,
`bogusWindowRecovery.test.ts`.

### Phantom-construct openers (retired with P4a slice 2's gate)

The raw-construct loop used to match `<?` / `<![CDATA[` / `<!X` / bogus
openers even while an outer text-consuming construct (an open comment
block, a RAW-TEXT type-1 block, parse5 raw text) owned the bytes — measured:
`<!--\n<?x` held `commentOpen` AND `piOpen` at once. The phantom state was
blocking-only, but its first-`>` divergence poison guarded a divergence
that does not exist between the REAL grammars (both call those bytes
text), and it poisoned three pinned-corpus documents to 0. The gate
removes the openers there — exact for BOTH grammars: micromark gives every
line up to a block's end line to the block; parse5's comment content runs
to its own terminator and its RAW-TEXT content to the element's end tag,
and where the two disagree about the terminator, the divergence poisons
have already fired before the gate is
consulted. Boundary movements: 8 increases (3 documents ×lineages), each
verified by the engine probe battery; no decreases.

The parse5 half of that argument covers **raw-text** elements, not every
CommonMark type-1 name. `pre` is type 1 to micromark and an ordinary DATA
element to parse5, so an opener on a `<pre>` line really does open a bogus
comment and the gate must not skip it — the type-1 member carries `raw`
for exactly this, and the gate reads that instead of the type (F13).

### P4 status — COMPLETE (the last separation landed)

The P4b-completion sequence closed the stage (seven commits, each gated):
P5Tok gained parse5's own comment state and the bogus branch was de-fused
(the first-`>` divergence is now a RELATION between the two grammars'
fields, pinned by the `--!>` test); MdBlock holds all seven html types
(6/7 by today's predicates, type 7 deliberately approximate);
`htmlFlowReal` is deleted — its four consumers read the member, each with
its direction argued at the site; `mayBeRawToMicromark` SURVIVES BY
DESIGN as the one deliberate (M)-side conservative flag covering the cut
type-7 exactness (its keep-argument sits where the composite is built,
and the nonType6QuotedGt corpus family stands guard over the hole). The
def gate migrated with its real safety argument (`defLineStart`'s
prevLineWasText half) written down and flip-pinned.

### Exact type 7 — SHIPPED (2026-08-25, the deferred cut closes)

The §8 cut is implemented as its own stage, nine commits, each gated:

1. `isType7Line` transcribes micromark's complete-tag automaton state for
   state (quoted values contain `>`; unquoted values chain `=`, looser
   than the spec's written grammar; `<a b=/>` is complete; the tagName
   dispatch's raw-name/block-name exits) — conformance-pinned against the
   LIVE remark-parse in `exactType7.test.ts`, so a micromark upgrade
   fails the pin instead of drifting.
2. `prevLineOpenContent` replaces the `prevLineWasText` proxy as the
   interrupt input (the proxy refused after headings/terminators/fence
   closes where micromark measurably opens). Battery in
   `type7Interrupt.test.ts`. Two classes are undecidable and poison
   instead of answering — see below.
3. Migration B rows 4/6/7 + truncated-open + seam-set migrate to the
   member (one consumer per commit, movements attributed per sample with
   the engine-probe battery: benign-201 +94 = masking row 4, hazard-518
   +107 = truncated-open); `mayBeRawToMicromark` is DELETED.
4. The ambiguous-starter hazard poison retires with the ambiguity: 69
   pinned entries rise across 34 docs — the stage's freeze-rate payoff —
   602 engine probes, zero defects.

Load-bearing correction recorded in Table A's notes: closing raw-text
names ARE type 7. `nonType6QuotedGt` now generates interrupt-context
shapes and guards the member-exactness claim.

#### The two undecidable interrupt classes

Both are STICKY markers consumed by the same residual poison at the tag
line, and both disarm at the blank, where the ambiguous structure provably
ended and the plain verdict is right again.

| Class           | Marker               | Why a line model cannot settle it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Armed by                                                                                                                           |
| --------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Pipe lines      | `tableMaybeOpen`     | After a GFM table ROW type 7 opens (a table is not content); after a pipe-bearing PARAGRAPH line it cannot — and table-ness was settled lines earlier by a header/delimiter pair. Sticky since 35f7593: a table is continued by ANY non-blank non-structural line, so `see prose` after `\| 1 \| 2 \|` is still a row (soak 20283008). The pre-35f7593 design asked "did THIS line hold a pipe", which lost the table across its own pipe-less rows                                                                              | any line containing `\|`, carried across every content-class line                                                                  |
| Container lines | `containerMaybeOpen` | micromark's `tagName` refuses type 7 on `self.interrupt && !self.parser.lazy[line]`, and the lazy half is an input the content model does not have. A tag line that LAZILY continues an open container opens a container-held block (`> quoted` + `<x-y/>`); a container whose last line was not a paragraph CLOSES, and the same tag line opens a TOP-LEVEL multi-line block (`> # h` + `<x-y/>`). Both readings say "opens" where the content table says "refused" — 16 of 21 container prefixes diverged, none poisoned (F14) | a blockquote marker, a list marker WITH content, a footnote definition, a def-list description — each only on a content-class line |

A BARE list marker (`-` alone) deliberately does not arm the container
marker: an empty item holds no paragraph, so the next line at block indent
is neither its content nor a lazy continuation, and the battery measures
that class as decided.

The battery's oracle walks the WHOLE mdast tree, not `tree.children`:
mdast reuses the `html` node type for inline html, so flow-ness is "the
parent is not a paragraph". A root-only oracle is blind to exactly the
container-held blocks this class is about, and it pinned four of the seven
container rows to the wrong answers until 2026-08-26.

### P4 status (original note, superseded)

Slices 1-2 landed (fence/math, then html types 1-5 after the phantom-opener
gate made the flags a partition): eleven of the thirteen (M)-side fields
are one union. The two RUN flags stay, deliberately: `htmlFlowReal` and
`htmlFlowSinceBlank` are not one-construct state but PROXIES, and their
~20 consumers ask different questions (parse5-rawness for the bogus-opener
gate, cross-line tag garbage, truncation pending, paragraph-vs-block
context for `openedInline`, masking, definitions, the seam). Folding them
into the union member would silently change several of those answers at
once — the exact mistake the plan's own P4b section forbids ("one sentence
covering five different questions"). So the run flags move OUT of P4a and
into the per-consumer stage, which now covers both. One entanglement to
carry into that work, measured while folding types 2-5: a type 2-5 opener
INSIDE a type 6/7 run takes the member (the comment state is doing
PARSE5-side duty there — a parse5 comment crosses the blank the md block
ends at), so `mdBlock` is not yet a pure (M) field; the per-consumer stage
inherits that note.

## Deviation ledger

Entries are kept after they are fixed, because the reasoning that once
declared them harmless is itself a thing to distrust.

| ID           | Deviation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Direction                                                                                                                         | Status                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1           | After a breakout tag pops the foreign root, the scanner still reported "in foreign content" and honoured a self-closing flag parse5 IGNORES: in `<svg><div></div><a/></svg>` parse5 leaves `<a>` OPEN and it swallows the rest of the document                                                                                                                                                                                                                                                                                                                                         | unsafe (under-counted open elements → widened the boundary)                                                                       | **fixed** 2026-08-21, `popForeignRoots()`                                                                                                                                                                                                                                                                                                                          |
| F2           | After the same pop, `<title>`/`<script>`/`<textarea>` DO switch the tokenizer, while the scanner kept applying foreign rules — so `rawTextOpen` never opened and the v2.5.3 inline raw-text poison never fired                                                                                                                                                                                                                                                                                                                                                                         | unsafe — **the shipped under-block**, found by fuzz seed 20260851 within one shard of adding the corpus family                    | **fixed** with F1, same one-line cause                                                                                                                                                                                                                                                                                                                             |
| F3           | `HTML_INTEGRATION_POINTS` omitted `title`, which IS an SVG HTML integration point, so a `<g/>` inside `<svg><title>` honoured a flag HTML rules ignore                                                                                                                                                                                                                                                                                                                                                                                                                                 | unsafe (same shape as F1)                                                                                                         | **fixed** 2026-08-21, name added                                                                                                                                                                                                                                                                                                                                   |
| F4           | `HTML_INTEGRATION_POINTS` includes `annotation-xml` unconditionally; it is one only when `encoding` is `text/html` or `application/xhtml+xml`                                                                                                                                                                                                                                                                                                                                                                                                                                          | safe (over-blocks)                                                                                                                | open, deliberately                                                                                                                                                                                                                                                                                                                                                 |
| F5           | The breakout pop was placed in `applyTag`, which VOID start tags never reach — `br`, `hr`, `img`, `embed` and `meta` are all breakout names, so `<svg><br><a/></svg>` still honoured the self-closing flag                                                                                                                                                                                                                                                                                                                                                                             | unsafe, same shape as F1                                                                                                          | **fixed** 2026-08-21 (`noteBreakout` at the skip sites); ten of twelve direction shards                                                                                                                                                                                                                                                                            |
| F6           | parse5's script-data "double escaped" state keeps `<script>` open across a `</script>` that ends CommonMark's type-1 block                                                                                                                                                                                                                                                                                                                                                                                                                                                             | unsafe — the grammars disagree about which bytes are raw, and no model reconciles them                                            | poisoned 2026-08-21; **retired** 2026-08-25 (P3b batch 1: exact ladder + splice crossing guard)                                                                                                                                                                                                                                                                    |
| APPROX #1–#5 | the five documented approximations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | safe                                                                                                                              | open, deliberately                                                                                                                                                                                                                                                                                                                                                 |
| F7           | An end tag whose element is hidden behind a scope barrier is discarded by parse5, while `tagBalance` decremented anyway — `<div><table></div></table>` reported balance and froze at 41 of 66                                                                                                                                                                                                                                                                                                                                                                                          | unsafe — **shipped under-block**, live since the scanner was written                                                              | **fixed** 2026-08-24 (`openStack` + scope walk); found by sweeping forward independence over prefix/tail pairs, not by fuzz                                                                                                                                                                                                                                        |
| F8           | `startTagInTemplate` routes `script`/`style`/`title`/`noframes` to "in head" without popping the template mode, so `_switchToTextParsing` captures IN_TEMPLATE in a tail-only parse and IN_BODY in the full one; the first stray end tag restores different modes — `a\n\n<title>\n\n*b*\n` (16 bytes) spliced without the empty `<p>` the full parse synthesizes                                                                                                                                                                                                                      | unsafe — **shipped under-block**                                                                                                  | **fixed** 2026-08-24 (`headRoutedCaptureUnclosed` bail in `spliceParse.ts`); `textarea`/`iframe`/`noembed`/`xmp` take the default branch, pop first, and are measured safe                                                                                                                                                                                         |
| F9           | A paragraph-inline `<?` / `<!`+letter / `<![CDATA[` crossing its line ending: micromark's block scan interrupts the paragraph at the next line (a doctype or barrier there never reaches `applyTag`), and parse5 reads the whole span as ONE bogus comment that sanitize removes — the text merge reaches BACKWARD past the boundary                                                                                                                                                                                                                                                   | unsafe — **two shipped under-blocks** (30 and 32 bytes)                                                                           | **fixed** 2026-08-24: document-wide poison, mirroring `DOCUMENT_STRUCTURE_NAMES` — an opener-offset poison measurably did not cover the backward merge                                                                                                                                                                                                             |
| F10          | A block-level RAWTEXT/RCDATA element still open across a BLANK line: the type-6 block ends (micromark) while parse5's raw-text state runs on, so later blocks are elements to one grammar and raw text to the other — `<iframe>` + blank + `*b*\n<div>…</div>\n</iframe>` left the div open swallowing the document while `rawTextOpen` suppressed every tag and the scanner called it balanced                                                                                                                                                                                        | unsafe — **shipped under-block** (63 bytes, one-character append rewrote the frozen region)                                       | **fixed** 2026-08-24: document-wide poison at the blank; type-1 blocks exempt (a blank does not end them, the grammars agree)                                                                                                                                                                                                                                      |
| F11          | A `<template>` block vanishes whole — children go to the content fragment (`from-parse5` hangs them off `.content`, not `.children`) and sanitize drops the element. Inside a list item or blockquote the later paragraphs land INSIDE the container and a one-character append rewrites the frozen region via lazy continuation                                                                                                                                                                                                                                                       | unsafe — **shipped under-block** (scaled-soak direction battery, two shards)                                                      | **fixed** 2026-08-24: `<template>` start tags poison document-wide, second erasure kind beside `DOCUMENT_STRUCTURE_NAMES`. The third refutation this week of a "measured harmless" sweep                                                                                                                                                                           |
| F12          | The paragraph-inline `<!--` poison was gated on `!inRawText`, which reads `htmlFlowSinceBlank` — a proxy ANY `<letter` line start sets. `<b>x</b> <!-- y` is a paragraph (`b` is not a type-6 name), the `<b` suppressed the poison, and 173 of 200 bytes froze across the sanitize-erasure merge                                                                                                                                                                                                                                                                                      | unsafe — **shipped under-block** (scaled soak, direction battery)                                                                 | **fixed** 2026-08-24: gate replaced by the exact line-start check, poison upgraded to document-wide (the F9 backward-merge rule). Predicted in the F9 fix comment: "the corpus carries the shapes that would catch it if that ever stops" — it did                                                                                                                 |
| F13          | The phantom-opener gate skipped the raw-construct openers while ANY CommonMark type-1 block was open. `pre` is in `TYPE1_NAMES` but not in `RAW_TEXT_ELEMENTS` — parse5 tokenizes `<pre>` content in the DATA state — so `<?x` / `<!y` / `<![CDATA[` / `</3` inside `<pre>` really open a bogus comment, which eats the `>` of the `</pre>` line and leaves the element open swallowing the rest of the document                                                                                                                                                                       | unsafe — **shipped under-block** (`<pre>\n<?x\n</pre>` + tail: 20 divergent streamed frames)                                      | **fixed** 2026-08-26: the type-1 member carries `raw`, set from the NAME at the claim site, and the gate reads it. Pre-91ced38 the phantom opener's own first-`>` poison covered this by accident; the gate removed the phantom AND the accidental cover. The pinned corpus never sampled the family (6063 entries, zero delta) — P4a's acceptance was blind to it |
| F14          | The exact-type-7 interrupt table routes every CONTAINER line (blockquote markers, list items, footnote definitions) to its content row and REFUSES the tag line after one. micromark's `tagName` carries a `!self.parser.lazy` exception: a lazily-continuing tag line opens a container-held html block, and a container closed by a non-paragraph last line leaves the tag line to open a TOP-LEVEL multi-line one. 16 of 21 container prefixes diverged, none poisoned — the scanner masked a real raw-text opener as a code span and froze a prefix a one-character append rewrote | unsafe — **shipped under-block** (a blockquote line, a `<br>` line and a backticked `<iframe>` line: boundary 60 of 64, frame 23) | **fixed** 2026-08-26: the container class joins the pipe class as a sticky undecidable marker (`containerMaybeOpen`), poisoning the tag line instead of answering. The battery had pinned the container rows to a ROOT-ONLY oracle blind to container-held html — the oracle was wrong before the model was                                                        |

F1–F3 were one root cause: **foreign-content depth was modelled as a count,
and the grammar it approximates is a stack.** That is also the argument for
the two-model split — a `Parse5TokenState` owning a real open-element stack
would have made all three impossible to write, rather than fixable after the
fact.

Worth recording separately: F1 and F2 were first classified as "deviates but
is absorbed downstream", on the strength of 3140 hand-built shapes that all
passed. The absorption was real but partial, and a hand-built sweep cannot
find the part it misses — the fuzz corpus crossed the family with a link
definition and a following paragraph, which no hand-written matrix had.
**A sweep that confirms a deviation is harmless is weaker evidence than a
sweep that finds nothing at all.**

## P1 conformance instruments (two-model plan)

Built 2026-08-24. Three instruments plus a pinned diff corpus; none touch
production code.

| Instrument           | File                                                                                    | Verdict authority                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine probe         | `conformanceOracles.ts` `engineProbe`                                                   | **Authoritative.** Streams `doc` then `doc + probe` through the real engine and deep-equals frame 2 against a fresh full parse, positions included, never gated on `usedIncremental`. A mismatch is a defect.      |
| (M) span oracle      | `conformanceOracles.ts` `mSpanDisagreement`                                             | Attribution. Covering-span sets at every frozen-region line start; in sweeps SNAPSHOT-anchored — `parse(doc)` vs `parse(doc+probe)` — per the bad-oracle finding below. Spans, not types.                          |
| (P) identity oracles | `conformanceOracles.ts` `rawLayerIdentityDisagreement` / `pipelineIdentityDisagreement` | Design instruments, prefix-anchored — home ground is HAND fixtures (formElement, F10). Sweeps run them only behind `ORACLE_RAW=1`: at scanner-granted boundaries the prefix anchoring overclaims, see below.       |
| Boundary diff        | `boundaryDiff.test.ts` + `boundaryBaseline.json`                                        | Regression net (§2.3). Per-sample boundaries over the pinned corpus × three lineages (engine/scanner/phantom); increases FAIL until the baseline is regenerated with a ledger entry; decreases report a histogram. |
| Pinned corpus        | `pinnedCorpus.ts`                                                                       | 17 frozen fixture docs + 3 purpose-built REF_RESOLUTION docs + 2000 pinned-seed fuzz samples, fingerprinted against corpus drift.                                                                                  |

**Corpus-regen rule (learned the hard way at v2.8.0):** any edit to
`fuzzGenerators.ts` or `pinnedCorpus.ts` shifts the pinned-seed sample
stream deterministically — on ANY node version — so it must regenerate
`boundaryBaseline.json` in the SAME commit, increases attributed in the
commit message. The v2.8.0 release run failed on exactly this: 35f7593
grew `interruptContextArb` without regenerating; the resulting fingerprint
drift was misattributed to a node 22.23.1→22.23.2 V8 change, and the 12
sample increases absorbed by the post-release regen (db9f091, e.g.
hazard-23:s 0→241, hazard-998 0→77) are corpus-composition changes from
that generator edit — new/shifted samples, not scanner movement. The node
pin in CI stays as determinism insurance (node 24 genuinely drifts the
fast-check stream), but node bumps within 22.x are not a regen trigger.

**One measured architecture fact** (it reshaped T1.2): the system's safety
contract is scanner boundary PLUS the splice-side guards. The bare node-list
identity at the scanner's boundary diverges for tails the splice
legitimately refuses — a `<td>` tail diverges after ANY paragraph prefix
(tail-alone fragment parse still starts "in template"; the full parse
popped to "in body"). An oracle that failed on that would be wrong, and one
that silently skipped it would mask F8. Hence the authority split above.

### Mutation check (§2.3) — the harness has failed on purpose

| Planted mutation                          | Result                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `blankRun += 1` → `+= 2`                  | diff FAILS (boundary increases)                                                                                          |
| drop `c.hazard` from candidate acceptance | diff FAILS (increases)                                                                                                   |
| drop the `<template>` erasure poison      | diff FAILS (increases)                                                                                                   |
| drop the link-def registration ((R) path) | 15 samples move down (REF_RESOLUTION ×2 + 13 fuzz), reported in the decrease histogram — conservative direction, visible |

The fixture library contains ZERO link reference definitions (measured
while validating the fourth mutation) — freezing past a resolved link ref
was covered only by ~13 of 2000 fuzz samples until the REF_RESOLUTION docs
pinned it by name.

### Classification ledger (T1.5)

**The load-bearing entry is a bad-oracle finding.** The first sweep ran
the layer instruments PREFIX-anchored — `parse(prefix)` vs
`parse(prefix+tail)` — and produced ~3.7k `info` firings at soak scale in
uniform every-probe families (firing even for the EMPTY probe). Diagnosis:
the scanner grants a boundary GIVEN every confirmed line of the snapshot
(blockers 3/4 settle candidates on evidence PAST the boundary), and the
engine cuts the SNAPSHOT's parse at the boundary — it never parses the
bare prefix. The prefix-anchored instrument asserts a strictly stronger
claim than the scanner makes, so those firings said nothing about the
scanner. Re-anchored to the snapshot (`parse(doc)` vs `parse(doc+probe)`),
the same 2×2000-doc sweep reports **zero** instrument firings and zero
defects. Per T1.5's own rule: the oracle was wrong; fixed, and said so.

Real divergence families the prefix-anchored instruments DID surface, kept
as exemptions for `ORACLE_RAW=1` runs and hand analysis — every direction
is refuse-or-absorb, never an under-block:

| #   | Family                                                                                                                                                           | Mechanism that owns it                               | Direction                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| E1  | Table-part tails (`<td>` probe): tail-alone fragment dispatch differs from in-context by construction (the F8 shape)                                             | splice-side stray-table-part bail                    | tail refused → full path                                  |
| E2  | GFM-table internal whitespace is foster-parented to the root and merges with the seam separator (grouping only, values conserved)                                | blocker-6 seam handling / splice seam synthesis      | seam-absorbed                                             |
| E3  | Footnote ref/def split across the boundary: tail-alone parse sees orphans, full parse resolves them — the raw() identity is stated WITHOUT the phantom mechanism | phantom injection replay (`remarkInjectPhantomDefs`) | production machinery, pinned by `assertStreamEquivalence` |

`formElement` remains the standing latent divergence (design §2.1): raw
layer fires, sanitize masks the element, the grouping echo keeps the final
layer firing; the scanner never grants the boundary (openStack keeps the
implicitly-closed form counted). Pinned as an oracle self-test — and since
2026-08-25 the two facts that keep it latent are DESIGNED guards with
tripwires (`formElementLatent.test.ts`), no longer accidents:

1. the end-tag walk removes only the matched element (no implied end
   tags), so an implicitly-closed `<form>` stays counted and blocks every
   later candidate — modelling implied end tags must ship an explicit
   formElement guard with it;
2. `form` is absent from the default sanitize `tagNames` (the named schema
   entry per the masking-exemption rule). A caller-supplied schema that
   allows `form` sits outside the default contract, like every ground-fact
   change above.

### T1.4 sweep result (2026-08-24)

Two seeds × (2000 benign + 2000 hazard docs) × ~9 probes each, plus the
20-doc realistic corpus × its catalog configs, snapshot-anchored: **zero
defects, zero instrument firings**. Probe-level incremental engagement:
benign 17449/18616 (93.7%), hazard 14472/16381 (88.3%) — the sweep
exercised the splice, not the fallback. Under lie-mode 2 this is a
regression net's green, not a safety proof.

### T1.6 baseline (2026-08-24, v2.5.5 + P0)

Boundary histogram over the pinned corpus, engine lineage, as a fraction
of document length (zeros dominated by the hazard-dense family — that is
the family's job):

```
zero 1331   1-25% 324   26-50% 202   51-75% 103   76-99% 60   100% 0
```

Realistic-doc boundaries (bytes frozen / doc length): GFM_BASICS 203/892,
PROSE_SAMPLE 225/500, TABLES_DOC 534/866, TASK_LIST_DOC 22/369 (list
continuation hazard — expected), FOOTNOTES_DOC 227/882,
DEFINITION_LIST_DOC 547/673, MATH_DOC 530/587, CJK_MIXED_DOC 271/434,
RTL_DOC 129/274, MARK_HIGHLIGHT_DOC 385/442, SMARTYPANTS_DOC 466/528,
COMMENTS_DOC 545/604, URL_SCHEMES_DOC 432/595, LINKED_PROSE_DOC 676/750,
CODE_SAMPLES_DOC 833/864, SECRETS_DOC 350/382, KITCHEN_SINK 2149/3857,
REF_RESOLUTION_LINK 91/95, REF_RESOLUTION_FOOTNOTE 92/96,
REF_RESOLUTION_TITLED 89/93.

Per-family marker coverage over the 2000 pinned fuzz samples: every one of
the 36 families ≥ 35 hits (floor 33 = RUNS/60); minima `headRoutedCapture`
35, `quotedGtOnTagLine` 37, `rawPhaseSplit` 46, `scriptEscape` 46.

**Standing caveat (lie-mode 2).** Every corpus above was selected by
surviving ALL CLEAN runs, so a green sweep under-reports by construction.
These instruments are regression nets and classification machinery; only
fresh-seed soak is a safety argument.

## Swept, and why each held

Recording the reason matters more than recording the pass: every one of
these is safe because of a blocker aimed at something else, so a change to
that blocker can un-safe them silently.

| Path                                       | Sweep                                                            | Held because                                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreign content, all four foreign branches | 3140 hand-built shapes, then the fuzz corpus                     | the hand-built sweep passed and was WRONG to reassure: fuzz found the under-block once `foreignContentArb` existed. Held by the pop until P3a; now by the collapse (count everything, poison raw-text starts) |
| Foster parenting out of a `<table>`        | 144 shapes with the merge target buried inside the frozen region | an open `<table>` holds `openTotal` above zero, so the boundary parks in front of the merge target BEFORE the fostered text exists                                                                            |
| `<template>` in the content                | 12 shapes × 3 schedules                                          | children go to a content fragment that never reaches hast, and sanitize drops the element                                                                                                                     |
| Script-data escape states                  | hand sweep passed, fuzz did NOT — see F6                         | not held: the double-escaped state now poisons                                                                                                                                                                |

## Open questions

Ordered by how much they would change the picture.

1. **The adoption agency algorithm.** Currently unreachable because
   unbalanced formatting elements block on tag balance — that is an
   accident of another blocker, not a decision, and it is untested as such.
2. **Lineage coverage — measured, not assumed.** There are three production
   call sites, and the picture is better than the folklore:

   | Lineage                          | Profile                                                                        | Covered by                                                                                                                        |
   | -------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
   | `advanceIncrementalParse.ts:169` | defaults + `defListEnabled`                                                    | all soak legs                                                                                                                     |
   | `remarkInjectPhantomDefs.ts:87`  | `defListEnabled:false, referenceTaint:false`, reads checkpoint fields directly | `spliceFuzz`'s third property drives `runCrossChunk`, which calls `phantomSuffixCloser` every frame — so leg 1 covers it          |
   | `collectDefLabels.ts:211`        | `defListEnabled:false, mathFlow:false, referenceTaint:false`                   | `collectDefLabels.fuzz.test.ts` exists and shares the corpus, but the soak script never ran it — **added as leg 3 on 2026-08-21** |

   What remains open is depth, not existence: the scanner lineage runs at
   the suite default (100 samples) unless a soak leg scales it.

3. **Corpus weights are a shared budget.** The coverage meters demand every
   family be sampled `RUNS/60` times, and that floor does not scale with the
   number of families — so adding one dilutes all the others. Growing the
   raw-HTML pool from 38 to 49 weights took the failure rate across twelve
   seeds from 1-in-12 to 4-in-12, until the default sample count went
   120 → 300. A scheme that derived each floor from its family's weight would
   remove the coupling; today it is manual.
