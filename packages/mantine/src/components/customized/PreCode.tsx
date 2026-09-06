'use client';

import { HTMLAttributes, memo, useEffect, useMemo, useRef, useState } from 'react';
import { CodeHighlight, CodeHighlightTabs, CodeHighlightControl } from '@mantine/code-highlight';
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-react-markdown/core';
import { useMantineCodeBlockOptions } from '../../hooks/useMantineCodeBlockOptions';
import MantineAIMMermaidCode from './MermaidCode';
import { CopyButton } from '@mantine/core';
import { prettyPrintJson } from './formatJson';
import { createJsonCompletenessScanner } from './jsonCompleteness';
export { jsonLooksComplete } from './jsonCompleteness';
export { prettyPrintJson } from './formatJson';

/**
 * highlight.js is NOT imported statically any more: the root entry carries
 * every language definition (~130 KB gzip) and the only always-on use was a
 * `getLanguage()` existence check that Mantine's own adapter already
 * performs (unknown language → plaintext). Auto-detection is the one real
 * consumer, and it loads the module on demand — only when
 * `autoDetectUnknownLanguage` is on and an unlabelled block shows up
 * (2026-08 project review, pkg-small-02: the static import defeated
 * consumers' `highlight.js/lib/core` slimming). Consumers who want it (and
 * mermaid) in the main bundle up front call `preloadMantineCodeAssets()`
 * at app start, or simply import the modules themselves.
 */
let hljsAutoPromise: Promise<{ highlightAuto: (code: string) => { language?: string } }> | null = null;
export const loadHljsForAutoDetect = () => {
  // A rejected load (transient network failure) is NOT cached: the next
  // attempt retries instead of leaving autodetection dead for the page.
  hljsAutoPromise ??= import('highlight.js').then(
    (m) => m.default,
    (err: unknown) => {
      hljsAutoPromise = null;
      throw err;
    }
  );
  return hljsAutoPromise;
};

/** Below this many characters a guess is noise; the block stays "unknown". */
const AUTODETECT_MIN_CHARS = 32;
/** Bounded automatic retries of a failed highlight.js module download. */
const HLJS_LOAD_RETRIES = 3;
const HLJS_LOAD_RETRY_MS = 1500;

/**
 * The language highlight.js guesses for an unlabelled block.
 *
 * `highlightAuto` scores every registered language against the whole text,
 * so re-running it on every streamed chunk was O(languages × n) per chunk —
 * O(n²) over a long block (pkg-small-06). Schedule instead:
 *   - first guess as soon as the block has AUTODETECT_MIN_CHARS (an early
 *     label rather than "unknown" for the whole stream);
 *   - a corrective re-run each time the block has DOUBLED in length since
 *     the last guess (32 → 64 → 128 → …): a wrong early guess on a long
 *     block is fixed within its next doubling, and the total work stays
 *     O(n) — at most log₂(n) runs;
 *   - a final verdict when streaming ends (the last run always sees the
 *     complete block).
 * Returns '' while disabled, still loading, or below the minimum, so the
 * block renders as plaintext/"unknown" and upgrades in place.
 */
function useAutoDetectedLanguage(codeText: string, enabled: boolean, streaming: boolean): string {
  const [detected, setDetected] = useState<{ language: string; atLength: number; finalFor: string | null } | null>(
    null
  );
  // Bumped after a failed `import('highlight.js')` so the effect re-runs on
  // otherwise unchanged inputs and retries the download — the mermaid
  // renderer's counterpart. Without it a static document whose only load
  // attempt failed stayed "unknown" for good (v2.4.2 review P2-2). Bounded.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadFailuresRef = useRef(0);
  const previousTextRef = useRef(codeText);
  useEffect(() => {
    const appended = codeText.startsWith(previousTextRef.current);
    previousTextRef.current = codeText;
    if (!enabled) {
      if (detected) setDetected(null);
      return;
    }
    // The block was REPLACED, not appended to (a regenerate reuses this
    // instance — the key is the block's source offset — or a same-offset
    // swap): a guess made for the old text is worthless for the new one.
    // Drop it so the schedule restarts (v2.4.0 review: the old label stuck
    // for the whole new stream until its end).
    // Do NOT return here: `detected` is not a dep, so a state reset alone
    // would never re-run the effect and a non-streaming replacement stayed
    // "unknown" for good (v2.4.1 review) — evaluate the schedule against
    // the cleared prior in this same pass.
    const prior = !appended || (detected !== null && codeText.length < detected.atLength) ? null : detected;
    if (prior !== detected) setDetected(null);
    if (codeText.length < AUTODETECT_MIN_CHARS) return;
    const due =
      prior === null ||
      // Not streaming: the verdict must be for THIS text (end-of-stream, or a
      // static content update).
      (!streaming && prior.finalFor !== codeText) ||
      // Streaming: doubled since the last guess.
      (streaming && codeText.length >= prior.atLength * 2);
    if (!due) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    loadHljsForAutoDetect().then(
      (hljs) => {
        if (cancelled) return;
        loadFailuresRef.current = 0;
        setDetected({
          language: hljs.highlightAuto(codeText).language ?? '',
          atLength: codeText.length,
          finalFor: streaming ? null : codeText,
        });
      },
      () => {
        // Load failed — stay "unknown" and retry the download a bounded
        // number of times (the loader does not cache rejections).
        if (cancelled || loadFailuresRef.current >= HLJS_LOAD_RETRIES) return;
        loadFailuresRef.current += 1;
        retryTimer = setTimeout(() => setLoadAttempt((n) => n + 1), HLJS_LOAD_RETRY_MS);
      }
    );
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
    // `detected` is deliberately not a dep: a completed guess must not
    // re-trigger the effect (it re-runs on the next content/streaming
    // change, which is when the schedule is re-evaluated). `loadAttempt`
    // re-runs it after a failed module download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeText, enabled, streaming, loadAttempt]);
  return enabled ? (detected?.language ?? '') : '';
}

/**
 * Loads mermaid and highlight.js ahead of time. Both are imported on demand
 * by the code-block renderers (the first diagram / the first auto-detected
 * block pays the download); an app that would rather take that cost at
 * startup — a documentation page whose first screen shows a diagram, say —
 * calls this once at boot. Safe to call repeatedly; failures are swallowed
 * (the renderers will simply load lazily later).
 */
export function preloadMantineCodeAssets(): Promise<void> {
  return Promise.all([import('mermaid'), loadHljsForAutoDetect()]).then(
    () => undefined,
    () => undefined
  );
}

/** Copy always uses source bytes, independently of display formatting. */
function RawCodeCopy({ code }: { code: string }) {
  return (
    <CopyButton value={code}>
      {({ copied, copy }) => (
        <CodeHighlightControl
          tooltipLabel={copied ? 'Copied' : 'Copy'}
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={copy}
        >
          {copied ? (
            '✓'
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M16 8V4H4v12h4" />
            </svg>
          )}
        </CodeHighlightControl>
      )}
    </CopyButton>
  );
}

/**
 * Code languages that receive specialized rendering instead of standard
 * syntax-highlighted code blocks. Adding a new member here automatically
 * marks that language as "special" — you only need to add the corresponding
 * rendering branch in the component's return.
 */
enum SpecialCodeLanguage {
  /** Rendered as interactive diagrams via {@link MantineAIMMermaidCode} */
  Mermaid = 'mermaid',
}

/** O(1) lookup set, derived from {@link SpecialCodeLanguage}. */
const SPECIAL_LANGUAGES = new Set<string>(Object.values(SpecialCodeLanguage));

/**
 * Mantine code block renderer for `<pre>` elements.
 *
 * Replaces the default `<pre>` rendering with Mantine's {@link CodeHighlight} or
 * {@link CodeHighlightTabs} components, providing syntax highlighting, expand/collapse
 * behavior, and file-name tabs.
 *
 * Behavior:
 * - If the code block has an explicit language annotation, uses that language.
 * - If no language is specified and the `codeBlock` group's
 *   `autoDetectUnknownLanguage` option is enabled, uses `highlight.js`
 *   auto-detection.
 * - Mermaid code blocks (`language-mermaid`) are rendered as interactive diagrams
 *   via {@link MantineAIMMermaidCode}.
 * - JSON code blocks are formatted without rounding numeric tokens; nested expansion is optional.
 * - Unrecognized languages render as plaintext with an "unknown" label using
 *   {@link CodeHighlight} (no tabs).
 * - Recognized languages render with {@link CodeHighlightTabs} showing the
 *   language name as the tab label.
 *
 * @param props.codeText - The raw text content of the code block.
 * @param props.existLanguage - Language identifier extracted from the `language-*` CSS class, if present.
 */
const MantineAIMPreCode = memo(
  (
    props: HTMLAttributes<HTMLPreElement> & {
      codeText: string;
      existLanguage?: string;
    }
  ) => {
    const { fontSize } = useAIMarkdownTheme();
    const { streaming } = useAIMarkdownState();
    const { autoDetectUnknownLanguage, defaultExpanded, formatJson, expandNestedJson } = useMantineCodeBlockOptions();

    const detectedLanguage = useAutoDetectedLanguage(
      props.codeText,
      autoDetectUnknownLanguage && !props.existLanguage,
      streaming
    );
    // Lower-cased once for every decision below: fence languages arrive in
    // whatever case the model wrote (` ```Mermaid `, ` ```JSON `), and both
    // the special-language switch and the JSON branch must agree
    // (2026-08 project review, pkg-small-08 — the mermaid check was
    // case-sensitive while the JSON check was not).
    const codeLanguage = (props.existLanguage || detectedLanguage).toLowerCase();

    // The language is passed straight to Mantine's highlighter, whose
    // adapter already degrades unknown languages to plaintext; the label
    // is "unknown" only when there is no language at all.
    const [usedCodeLanguage, usedFileName] = useMemo(
      () => (codeLanguage ? [codeLanguage, codeLanguage] : ['plaintext', 'unknown']),
      [codeLanguage]
    );

    const isSpecialCodeBlock = SPECIAL_LANGUAGES.has(codeLanguage);

    const [scanJson] = useState(createJsonCompletenessScanner);
    const jsonComplete = useMemo(
      () => (usedCodeLanguage === 'json' && formatJson && streaming ? scanJson(props.codeText) : false),
      [usedCodeLanguage, formatJson, streaming, scanJson, props.codeText]
    );

    const normalCodeBlockContent = useMemo(() => {
      if (isSpecialCodeBlock) return null;
      let usedCodeStr = props.codeText;
      // JSON pretty-print as soon as the block LOOKS complete: a streamed
      // prefix never parses, so trying to pretty-print every chunk of a
      // growing block was O(n²) work for nothing (pkg-small-06) — but a
      // block that finished mid-document must not wait for the whole
      // message to end. "Ends with a closing bracket" alone was not enough
      // of a tell: pretty-printed JSON (the common LLM shape) ends a chunk
      // on `}` / `]` at almost every nesting level, so the parse still ran
      // on nearly every chunk (v2.4.1 review). Only a BALANCED bracket
      // scan (strings skipped, one linear pass) admits the parse.
      if (formatJson && usedCodeStr && usedCodeLanguage === 'json' && (!streaming || jsonComplete)) {
        usedCodeStr = prettyPrintJson(usedCodeStr, expandNestedJson);
      }
      return usedFileName === 'unknown' ? (
        <CodeHighlight
          mb={15}
          fz={fontSize}
          w="100%"
          code={usedCodeStr}
          withBorder
          withExpandButton
          defaultExpanded={defaultExpanded}
          maxCollapsedHeight="320px"
          withCopyButton={false}
          controls={[<RawCodeCopy key="copy" code={props.codeText} />]}
        />
      ) : (
        <CodeHighlightTabs
          mb={15}
          fz={fontSize}
          w="100%"
          code={[
            {
              fileName: usedFileName,
              code: usedCodeStr,
              language: usedCodeLanguage,
            },
          ]}
          withBorder
          withExpandButton
          defaultExpanded={defaultExpanded}
          maxCollapsedHeight="320px"
          withCopyButton={false}
          controls={[<RawCodeCopy key="copy" code={props.codeText} />]}
        />
      );
    }, [
      isSpecialCodeBlock,
      props.codeText,
      usedCodeLanguage,
      usedFileName,
      fontSize,
      defaultExpanded,
      streaming,
      formatJson,
      expandNestedJson,
      jsonComplete,
    ]);

    const specialCodeBlockContent = useMemo(() => {
      switch (codeLanguage) {
        case SpecialCodeLanguage.Mermaid:
          return <MantineAIMMermaidCode code={props.codeText} />;
        default:
          return null;
      }
    }, [codeLanguage, props.codeText]);

    return isSpecialCodeBlock ? specialCodeBlockContent : normalCodeBlockContent;
  }
);

MantineAIMPreCode.displayName = 'MantineAIMPreCode';

export default MantineAIMPreCode;
