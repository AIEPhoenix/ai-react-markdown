'use client';

import { HTMLAttributes, memo, useEffect, useMemo, useState } from 'react';
import { CodeHighlight, CodeHighlightTabs } from '@mantine/code-highlight';
import { deepParseJson } from 'deep-parse-json';
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-react-markdown/core';
import { useMantineCodeBlockOptions } from '../../hooks/useMantineCodeBlockOptions';
import MantineAIMMermaidCode from './MermaidCode';

/**
 * highlight.js is NOT imported statically any more: the root entry carries
 * every language definition (~130 KB gzip) and the only always-on use was a
 * `getLanguage()` existence check that Mantine's own adapter already
 * performs (unknown language → plaintext). Auto-detection is the one real
 * consumer, and it loads the module on demand — only when
 * `autoDetectUnknownLanguage` is on AND an unlabelled block has finished
 * streaming (2026-08 project review, pkg-small-02 / pkg-small-06: the
 * static import defeated consumers' `highlight.js/lib/core` slimming, and
 * `highlightAuto` re-scored the growing block on every streamed chunk).
 */
let hljsAutoPromise: Promise<{ highlightAuto: (code: string) => { language?: string } }> | null = null;
const loadHljsForAutoDetect = () => {
  hljsAutoPromise ??= import('highlight.js').then((m) => m.default);
  return hljsAutoPromise;
};

/**
 * The language highlight.js guesses for an unlabelled block — resolved once
 * the block has finished streaming (a truncated prefix scores badly and the
 * scoring itself is O(languages × text) per call). Returns '' while
 * disabled, streaming, or still loading, so the block renders as
 * plaintext/"unknown" in the meantime and upgrades in place.
 */
function useAutoDetectedLanguage(codeText: string, enabled: boolean, streaming: boolean): string {
  const [detected, setDetected] = useState<{ code: string; language: string } | null>(null);
  useEffect(() => {
    if (!enabled || streaming || !codeText) return;
    let cancelled = false;
    void loadHljsForAutoDetect().then((hljs) => {
      if (cancelled) return;
      setDetected({ code: codeText, language: hljs.highlightAuto(codeText).language ?? '' });
    });
    return () => {
      cancelled = true;
    };
  }, [codeText, enabled, streaming]);
  return enabled && detected?.code === codeText ? detected.language : '';
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
 * - JSON code blocks are deep-parsed and pretty-printed before display.
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
    const { autoDetectUnknownLanguage, defaultExpanded } = useMantineCodeBlockOptions();

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

    const normalCodeBlockContent = useMemo(() => {
      if (isSpecialCodeBlock) return null;
      let usedCodeStr = props.codeText;
      // JSON pretty-print only once the block is complete: a streaming
      // prefix is not valid JSON anyway, and deepParseJson over the growing
      // text on every chunk is O(n²) work for nothing (pkg-small-06).
      if (usedCodeStr && !streaming && usedCodeLanguage === 'json') {
        const deepParsedResult = deepParseJson(usedCodeStr);
        usedCodeStr =
          typeof deepParsedResult === 'string' ? deepParsedResult : JSON.stringify(deepParsedResult, null, 2);
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
        />
      );
    }, [isSpecialCodeBlock, props.codeText, usedCodeLanguage, usedFileName, fontSize, defaultExpanded, streaming]);

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
