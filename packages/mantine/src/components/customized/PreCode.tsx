'use client';

import { HTMLAttributes, memo, useMemo } from 'react';
import { CodeHighlight, CodeHighlightTabs } from '@mantine/code-highlight';
import { deepParseJson } from 'deep-parse-json';
import hljs from 'highlight.js';
import { useMantineAIMarkdownRenderState } from '../../hooks/useMantineAIMarkdownRenderState';
import MantineAIMMermaidCode from './MermaidCode';

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
 * - If no language is specified and `config.codeBlock.autoDetectUnknownLanguage` is
 *   enabled, uses `highlight.js` auto-detection.
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
    const renderState = useMantineAIMarkdownRenderState();

    const codeLanguage = useMemo(() => {
      if (props.existLanguage) return props.existLanguage;
      if (renderState.config.codeBlock.autoDetectUnknownLanguage) {
        return hljs.highlightAuto(props.codeText).language || '';
      }
      return '';
    }, [props.existLanguage, props.codeText, renderState.config.codeBlock.autoDetectUnknownLanguage]);

    const [usedCodeLanguage, usedFileName] = useMemo(() => {
      if (!codeLanguage) return ['plaintext', 'unknown'];
      if (!hljs.getLanguage(codeLanguage)) {
        return ['plaintext', codeLanguage];
      }
      return [codeLanguage, codeLanguage];
    }, [codeLanguage]);

    const isSpecialCodeBlock = SPECIAL_LANGUAGES.has(codeLanguage);

    const normalCodeBlockContent = useMemo(() => {
      if (isSpecialCodeBlock) return null;
      let usedCodeStr = props.codeText;
      if (usedCodeStr && usedCodeLanguage.toLowerCase() === 'json') {
        const deepParsedResult = deepParseJson(usedCodeStr);
        usedCodeStr =
          typeof deepParsedResult === 'string' ? deepParsedResult : JSON.stringify(deepParsedResult, null, 2);
      }
      return usedFileName === 'unknown' ? (
        <CodeHighlight
          mb={15}
          fz={renderState.fontSize}
          w="100%"
          code={usedCodeStr}
          withBorder
          withExpandButton
          defaultExpanded={renderState.config.codeBlock.defaultExpanded}
          maxCollapsedHeight="320px"
        />
      ) : (
        <CodeHighlightTabs
          mb={15}
          fz={renderState.fontSize}
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
          defaultExpanded={renderState.config.codeBlock.defaultExpanded}
          maxCollapsedHeight="320px"
        />
      );
    }, [
      isSpecialCodeBlock,
      props.codeText,
      usedCodeLanguage,
      usedFileName,
      renderState.fontSize,
      renderState.config.codeBlock.defaultExpanded,
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
