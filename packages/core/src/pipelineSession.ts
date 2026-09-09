/** Per-consumer parse state and full/incremental fallback policy.
 * The host decides whether a next frame is expected (false for SSR), owns
 * this session, and resets it when render policy invalidates retained trees.
 * Parsing does not register chunks or publish document contributions.
 */
import {
  advanceIncrementalParse,
  buildPhantomSuffix,
  phantomSuffixCloser,
  parseStage,
  transformStage,
  type IncrementalParseState,
  type PipelineOptions,
  type AdvanceOptions,
} from '@ai-markdown/engine';

import type { Root as MdastRoot } from 'mdast';
import type { Root as HastRoot } from 'hast';

export interface PipelineTrees {
  mdast: MdastRoot;
  hast: HastRoot;
}
export interface PipelineSession {
  /** Drop retained incremental state. Does not dispose host subscriptions. */
  reset(): void;
  /** Read-only borrowed trees: clone before destructive rendering. */
  parse(options: PipelineFrameOptions): PipelineTrees;
}

type RemarkRehypeOptions = NonNullable<PipelineOptions['remarkRehypeOptions']>;
export interface PipelineFrameOptions {
  content: string;
  targetPhantoms: { missingFootnotes: Set<string>; missingLinks: Set<string> };
  remarkPlugins: PipelineOptions['remarkPlugins'];
  rehypePlugins: PipelineOptions['rehypePlugins'];
  remarkRehypeOptions: PipelineOptions['remarkRehypeOptions'];
  handlers?: RemarkRehypeOptions['handlers'];
  preserveForBodyHarvest: boolean;
  documentId: string;
  provenance: string;
  /** False for a one-shot server render; no browser-global probe is needed. */
  incrementalParse: boolean;
  defListEnabled: boolean;
  measure?: AdvanceOptions['measure'];
}
const unmeasured: NonNullable<AdvanceOptions['measure']> = (_stage, fn) => fn();

export function createPipelineSession(): PipelineSession {
  let state: IncrementalParseState | null = null;
  return {
    reset(): void {
      state = null;
    },
    parse({
      content,
      targetPhantoms,
      remarkPlugins,
      rehypePlugins,
      remarkRehypeOptions,
      handlers,
      preserveForBodyHarvest,
      documentId,
      provenance,
      incrementalParse,
      defListEnabled,
      measure: measureHere = unmeasured,
    }: PipelineFrameOptions) {
      // The suffix is APPENDED (the engine treats it as an always-tail
      // input; prepending would shift every source position). A frame that
      // ends inside an open fence / `$$` block would swallow it — sentinel
      // lines rendered as code, every cross-chunk ref falling back to
      // literal text for the block's whole streaming lifetime — so the
      // engine first emits an output-neutral closer for that block (see
      // phantomSuffixCloser; '' when nothing is open or the phase is
      // untrusted). Only chunks with a non-empty suffix pay the line scan.
      const phantomDefs = buildPhantomSuffix(targetPhantoms);
      const phantomSuffix = phantomDefs === '' ? '' : phantomSuffixCloser(content ?? '') + phantomDefs;
      const augmented = (content ?? '') + phantomSuffix;
      const baseHandlers = remarkRehypeOptions?.handlers ?? {};
      const mergedRemarkRehypeOptions = (
        handlers
          ? {
              ...remarkRehypeOptions,
              handlers: { ...baseHandlers, ...handlers },
              // Phantom label sets are empty in standalone mode (no PASS 0.5
              // injection happened); the footnoteDefinition handler still reads
              // them via `state.options.phantomFootnoteLabels.has(id)`, which
              // returns false for every id → orphan-protect path proceeds.
              phantomFootnoteLabels: targetPhantoms.missingFootnotes,
              phantomLinkLabels: targetPhantoms.missingLinks,
              preserveOrphan: preserveForBodyHarvest,
              documentId,
              // The SAME value `buildCoreRehypePlugins` received — the
              // verifier unwraps every placeholder stamped with anything else.
              provenance,
            }
          : {
              ...remarkRehypeOptions,
            }
      ) as RemarkRehypeOptions;

      // Coordinated (registry) mode is incremental-eligible since v2: the
      // engine takes the phantom suffix as a separate always-tail input (its
      // frame-to-frame churn re-parses only the tail — the reference taint
      // keeps every phantom-resolved ref out of the frozen prefix), and the
      // contribute effect's inputs are covered by splice equivalence (mdast)
      // plus the replay-regenerated footer (hast). When the flag is off, the
      // state is CLEARED — a later eligible frame must never splice against
      // trees parsed under different conditions.
      //
      // SSR takes this branch too: the engine's first-frame scan exists to
      // seed the NEXT frame's checkpoint, and a per-request server render
      // has no next frame — routing through the engine would pay a dead
      // O(document) line-lex per request. Hydration is unaffected (the
      // client's first frame rebuilds from null either way).
      if (!incrementalParse) {
        state = null;
        // Dev-only stage telemetry (`ai-markdown:stage:*` performance
        // measures; no-op in production). Wraps only the stage calls — the
        // surrounding option assembly is trivial.
        const parsed = measureHere('parse', () =>
          parseStage({
            children: augmented,
            remarkPlugins,
            rehypePlugins,
            remarkRehypeOptions: mergedRemarkRehypeOptions,
          })
        );
        const hastRoot = measureHere('transform', () => transformStage(parsed));
        return { mdast: parsed.mdast, hast: hastRoot };
      }

      try {
        const result = advanceIncrementalParse(state, content ?? '', {
          remarkPlugins,
          rehypePlugins,
          remarkRehypeOptions: mergedRemarkRehypeOptions,
          // Identity tuple over every parse input beyond the content itself.
          // Deliberately covers MORE than the G3 flush's 12 fields (handlers /
          // preserveForBodyHarvest / documentId can change without touching
          // any G3 field — e.g. a `preserveOrphanReferences` flip). The
          // phantom label sets are deliberately NOT here: their churn tracks
          // the suffix (always re-parsed with the tail), never the prefix.
          depsKey: [
            remarkPlugins,
            rehypePlugins,
            remarkRehypeOptions,
            handlers,
            preserveForBodyHarvest,
            documentId,
            // Explicit even though `rehypePlugins` already carries it: a
            // credential change must never reuse trees stamped under the
            // old one.
            provenance,
          ],
          defListEnabled,
          phantomSuffix,
          measure: measureHere,
        });
        state = result.nextState;
        return { mdast: result.mdast, hast: result.hast };
      } catch (error) {
        // The engine mutates prev's scan checkpoint IN PLACE before the tail
        // parse/splice — a throw mid-frame (an engine bug, or a plugin
        // choking on the synthetic tail source) leaves the retained state's
        // checkpoint describing content the state's trees do not. Clearing
        // the ref restores the "state is CLEARED when unusable" discipline;
        // the frame then renders via the ordinary full pipeline so one bad
        // frame cannot take the surface down.
        state = null;
        if (process.env.NODE_ENV !== 'production') {
          console.error('[ai-react-markdown] incremental parse failed — full parse fallback for this frame:', error);
        }
        const parsed = measureHere('parse', () =>
          parseStage({
            children: augmented,
            remarkPlugins,
            rehypePlugins,
            remarkRehypeOptions: mergedRemarkRehypeOptions,
          })
        );
        const hastRoot = measureHere('transform', () => transformStage(parsed));
        return { mdast: parsed.mdast, hast: hastRoot };
      }
    },
  };
}
