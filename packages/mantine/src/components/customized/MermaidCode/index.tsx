'use client';

import React, { memo, useEffect, useRef, useState, useCallback } from 'react';
import { CodeHighlightControl, CodeHighlightTabs } from '@mantine/code-highlight';
import { ActionIcon, CopyButton, Flex, Tooltip } from '@mantine/core';
import mermaid from 'mermaid';
import { useMantineAIMarkdownRenderState } from '../../../hooks/useMantineAIMarkdownRenderState';
import './styles.scss';

/** Static `<pre>` style for the mermaid container. */
const PRE_STYLE = { cursor: 'pointer', overflow: 'auto', width: '100%', padding: '0.5rem' } as const;

/**
 * Generate a unique ID for mermaid SVG rendering.
 * Combines a timestamp with a random suffix to avoid collisions when
 * multiple mermaid diagrams render concurrently.
 *
 * @returns A unique string in the format `mermaid-{timestamp}-{random}`.
 */
const generateMermaidUUID = () => {
  return `mermaid-${new Date().getTime()}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Open the rendered mermaid SVG in a new browser window.
 *
 * Clones the SVG element, applies a background color matching the current
 * color scheme, serializes it to an object URL, and opens it in a new tab.
 * The object URL is revoked after a short delay to free memory.
 *
 * @param svgElement - The rendered SVG element to view, or `null`/`undefined` to no-op.
 * @param isDark - Whether the current color scheme is dark (used for background color).
 */
const handleViewSVGInNewWindow = (svgElement: SVGElement | null | undefined, isDark: boolean) => {
  if (!svgElement) return;
  const targetSvg = svgElement.cloneNode(true) as SVGElement;
  targetSvg.style.backgroundColor = isDark ? '#242424' : 'white';
  const text = new XMLSerializer().serializeToString(targetSvg);
  const blob = new Blob([text], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  window.open(url);
  // Revoke unconditionally: the delay covers the navigation race when the
  // window opened, and prevents a blob URL leak when the popup was blocked.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

/** Shared wrapper for the inline Tabler-style stroke icons in the header
 *  controls. One place owns the 9 presentation attributes; call sites supply
 *  only their `<path>` data (and optionally a size). */
const TablerIcon = ({ size = 16, children }: { size?: number; children: React.ReactNode }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    strokeWidth="2"
    stroke="currentColor"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={`${size}px`}
    height={`${size}px`}
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
    {children}
  </svg>
);

/**
 * Interactive mermaid diagram renderer.
 *
 * Parses and renders mermaid diagram source code into an inline SVG visualization.
 * Automatically adapts to the current Mantine color scheme (light/dark) by
 * re-initializing mermaid with the appropriate theme.
 *
 * Features:
 * - Live SVG rendering with automatic dark/light theme switching
 * - Fallback to raw source code display on parse/render errors
 * - Toggle between rendered diagram and raw mermaid source
 * - Click on the rendered diagram to open the SVG in a new browser window
 * - Copy button for the raw mermaid source code
 * - Chart type label extracted from mermaid's parse result
 * - Preserves the last successful render across transient PARSE failures
 *   (the streaming common case: incomplete code). A DRAW-stage failure —
 *   parse passed but `mermaid.render` threw — is a real error for the
 *   current code and switches to the error view instead of silently showing
 *   a stale diagram.
 *
 * Note: mermaid keeps a single GLOBAL config — the `mermaid.initialize` call
 * here overwrites any configuration the host application set on the same
 * mermaid instance (and vice versa).
 *
 * @param props.code - Raw mermaid diagram source code to render.
 */
const MantineAIMMermaidCode = memo((props: { code: string }) => {
  const renderState = useMantineAIMarkdownRenderState();
  const isDark = renderState.colorScheme === 'dark';

  const ref = useRef<HTMLPreElement>(null);
  const renderVersionRef = useRef(0);
  const hasRenderedRef = useRef(false);
  const [showOriginalCode, setShowOriginalCode] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [chartType, setChartType] = useState('unknown');

  useEffect(() => {
    if (!props.code || !ref.current || showOriginalCode) {
      return;
    }

    const renderVersion = ++renderVersionRef.current;
    let cancelled = false;

    const renderMermaid = async () => {
      // Which stage failed decides the failure UX below: a parse failure on
      // streaming-incomplete code is transient noise (keep the last good
      // diagram — mermaid never touched the host), while a draw failure is a
      // real error for the CURRENT code (parse passed; `mermaid.render`
      // rejected it, often deterministically) and must not leave a stale
      // diagram masquerading as the new content.
      let drawStageReached = false;
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'base',
          darkMode: isDark,
          // Mermaid draws an "error bomb" graphic into the container before
          // throwing — suppress it; the catch below owns failure rendering.
          suppressErrorRendering: true,
        });
        const parseResult = await mermaid.parse(props.code);
        if (!parseResult) {
          throw new Error('Failed to parse mermaid code');
        }

        const hostElement = ref.current;
        if (!hostElement || cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }

        drawStageReached = true;
        const { svg, bindFunctions, diagramType } = await mermaid.render(
          generateMermaidUUID(),
          props.code,
          hostElement
        );
        if (!ref.current || cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }

        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
        hasRenderedRef.current = true;
        setChartType(diagramType);
        setRenderError(false);
      } catch {
        if (cancelled || renderVersion !== renderVersionRef.current) {
          // A newer attempt owns the host (mermaid serializes render calls
          // on a global queue, so it runs strictly after this one and
          // clears/redraws the host itself).
          return;
        }
        if (!drawStageReached && hasRenderedRef.current) {
          // Transient parse failure mid-stream: mermaid.render was never
          // called, the host still shows the last good diagram — keep it.
          return;
        }
        // First-render failure, or a draw-stage failure (mermaid cleared the
        // host before throwing): show the error view with the CURRENT code.
        // Sweep any temp `#d{id}` element a mid-render throw point outside
        // mermaid's cleanup wrappers may have stranded.
        ref.current?.querySelectorAll(':scope > [id^="dmermaid-"]').forEach((element) => element.remove());
        setChartType('unknown');
        setRenderError(true);
      }
    };

    void renderMermaid();

    return () => {
      cancelled = true;
    };
  }, [props.code, isDark, showOriginalCode]);

  const viewSvgInNewWindow = useCallback(() => {
    handleViewSVGInNewWindow(ref.current?.querySelector('svg'), isDark);
  }, [isDark]);

  return (
    <>
      {(showOriginalCode || renderError) && (
        <CodeHighlightTabs
          mb={15}
          fz={renderState.fontSize}
          w="100%"
          code={[
            {
              fileName: renderError ? 'Mermaid Render Error' : 'mermaid',
              code: props.code,
              language: 'mermaid',
            },
          ]}
          defaultExpanded={renderState.config.codeBlock.defaultExpanded}
          maxCollapsedHeight="320px"
          styles={{
            filesScrollarea: {
              right: '90px',
            },
          }}
          controls={
            renderError
              ? []
              : [
                  <CodeHighlightControl
                    tooltipLabel="Render Mermaid"
                    key="render-mermaid"
                    onClick={() => {
                      setShowOriginalCode(false);
                    }}
                  >
                    <Flex align="center" justify="center" w={18} h={18}>
                      <TablerIcon>
                        <path d="M12 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
                        <path d="M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
                        <path d="M19 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
                        <path d="M6.5 17.5l5.5 -4.5l5.5 4.5"></path>
                        <path d="M12 7l0 6"></path>
                      </TablerIcon>
                    </Flex>
                  </CodeHighlightControl>,
                ]
          }
          withBorder
          withExpandButton
        />
      )}
      <div
        className={`aim-mantine-mermaid-code ${isDark ? 'dark' : ''}`}
        style={
          showOriginalCode || renderError
            ? {
                display: 'none',
              }
            : {}
        }
      >
        <div className="chart-header">
          <div className="chart-type-tag">{chartType}</div>
          <Flex align="center" justify="flex-end" gap={0}>
            <Tooltip label="Show Mermaid Code">
              <ActionIcon
                size={28}
                className="action-icon"
                variant="transparent"
                onClick={() => {
                  setShowOriginalCode(true);
                }}
              >
                <Flex align="center" justify="center" w={18} h={18}>
                  <TablerIcon>
                    <path d="M7 8l-4 4l4 4"></path>
                    <path d="M17 8l4 4l-4 4"></path>
                    <path d="M14 4l-4 16"></path>
                  </TablerIcon>
                </Flex>
              </ActionIcon>
            </Tooltip>
            <CopyButton value={props.code}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                  <ActionIcon variant="transparent" size={28} className="action-icon" onClick={copy}>
                    {copied ? (
                      <TablerIcon size={18}>
                        <path d="M5 12l5 5l10 -10"></path>
                      </TablerIcon>
                    ) : (
                      <TablerIcon size={18}>
                        <path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"></path>
                        <path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"></path>
                      </TablerIcon>
                    )}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Flex>
        </div>
        <pre ref={ref} style={PRE_STYLE} onClick={viewSvgInNewWindow} />
      </div>
    </>
  );
});

MantineAIMMermaidCode.displayName = 'MantineAIMMermaidCode';

export default MantineAIMMermaidCode;
