/**
 * micromark extension for `==mark==` highlight syntax.
 *
 * Attention-style tokenizer modeled on `micromark-extension-gfm-strikethrough`,
 * derived from the (MIT, unmaintained) upstreams `remark-mark-highlight` and
 * `micromark-extension-highlight-mark` — both ship this same tokenizer; this
 * package is its maintained continuation. Behavior is pinned byte-for-byte
 * against `remark-mark-highlight@0.1.1` by the parity corpus in
 * `parity.test.ts` (`test/fixtures/baseline-0.1.1.json`, generated BEFORE the
 * swap so it stays an independent oracle).
 *
 * Sequence length is exactly two `=`; open/close classification follows the
 * standard attention flanking rules via `classifyCharacter`.
 *
 * @module syntax
 */

import { splice } from 'micromark-util-chunked';
import { classifyCharacter } from 'micromark-util-classify-character';
import { resolveAll } from 'micromark-util-resolve-all';
import { codes, constants, types } from 'micromark-util-symbol';
import type { Construct, Event, Extension, State, Token, TokenizeContext, Tokenizer } from 'micromark-util-types';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    highlight: 'highlight';
    highlightText: 'highlightText';
    highlightSequence: 'highlightSequence';
    highlightSequenceTemporary: 'highlightSequenceTemporary';
  }
}

const SEQUENCE_TEMPORARY = 'highlightSequenceTemporary';
const SEQUENCE = 'highlightSequence';
const HIGHLIGHT = 'highlight';
const HIGHLIGHT_TEXT = 'highlightText';

/** Create the micromark extension enabling `==mark==` highlight syntax. */
export function markHighlight(): Extension {
  const tokenizer: Construct = {
    name: 'highlight',
    tokenize: tokenizeHighlight,
    resolveAll: resolveAllHighlight,
  };

  return {
    text: { [codes.equalsTo]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [codes.equalsTo] },
  };

  /** Pair open/close sequences into highlight tokens; demote leftovers to data. */
  function resolveAllHighlight(events: Event[], context: TokenizeContext): Event[] {
    let index = -1;

    while (++index < events.length) {
      if (events[index][0] === 'enter' && events[index][1].type === SEQUENCE_TEMPORARY && events[index][1]._close) {
        let open = index;
        while (open--) {
          if (
            events[open][0] === 'exit' &&
            events[open][1].type === SEQUENCE_TEMPORARY &&
            events[open][1]._open &&
            // Sequences are all length 2, but keep the equal-length guard the
            // upstreams carry — it is part of the pinned behavior.
            events[index][1].end.offset - events[index][1].start.offset ===
              events[open][1].end.offset - events[open][1].start.offset
          ) {
            events[index][1].type = SEQUENCE;
            events[open][1].type = SEQUENCE;

            const highlight: Token = {
              type: HIGHLIGHT,
              start: Object.assign({}, events[open][1].start),
              end: Object.assign({}, events[index][1].end),
            };
            const text: Token = {
              type: HIGHLIGHT_TEXT,
              start: Object.assign({}, events[open][1].end),
              end: Object.assign({}, events[index][1].start),
            };

            const nextEvents: Event[] = [
              ['enter', highlight, context],
              ['enter', events[open][1], context],
              ['exit', events[open][1], context],
              ['enter', text, context],
            ];
            const insideSpan = context.parser.constructs.insideSpan.null;
            if (insideSpan) {
              splice(nextEvents, nextEvents.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
            }
            splice(nextEvents, nextEvents.length, 0, [
              ['exit', text, context],
              ['enter', events[index][1], context],
              ['exit', events[index][1], context],
              ['exit', highlight, context],
            ]);

            splice(events, open - 1, index - open + 3, nextEvents);
            index = open + nextEvents.length - 2;
            break;
          }
        }
      }
    }

    index = -1;
    while (++index < events.length) {
      if (events[index][1].type === SEQUENCE_TEMPORARY) {
        events[index][1].type = types.data;
      }
    }

    return events;
  }

  function tokenizeHighlight(this: TokenizeContext, effects: Parameters<Tokenizer>[0], ok: State, nok: State): State {
    const previous = this.previous;
    const events = this.events;
    let size = 0;

    return start;

    function start(code: Parameters<State>[0]): State | undefined {
      // A `=` directly before us that is not an escape means we are inside a
      // longer run the construct already rejected — do not re-enter.
      if (previous === codes.equalsTo && events[events.length - 1][1].type !== types.characterEscape) {
        return nok(code);
      }
      effects.enter(SEQUENCE_TEMPORARY);
      return more(code);
    }

    function more(code: Parameters<State>[0]): State | undefined {
      const before = classifyCharacter(previous);

      if (code === codes.equalsTo) {
        // A third `=` is not a highlight sequence.
        if (size > 1) return nok(code);
        effects.consume(code);
        size++;
        return more;
      }

      if (size < 2) return nok(code);

      const token = effects.exit(SEQUENCE_TEMPORARY);
      const after = classifyCharacter(code);
      token._open = !after || (after === constants.attentionSideAfter && Boolean(before));
      token._close = !before || (before === constants.attentionSideAfter && Boolean(after));
      return ok(code);
    }
  }
}
