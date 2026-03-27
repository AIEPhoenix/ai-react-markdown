'use client';

import React, { memo, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { CodeHighlightControl, CodeHighlightTabs } from '@mantine/code-highlight';
import { ActionIcon, CopyButton, Flex, Tooltip } from '@mantine/core';
import debounce from 'lodash-es/debounce';
import mermaid from 'mermaid';
import { useMantineAIMarkdownRenderState } from '../../../hooks/useMantineAIMarkdownRenderState';
import './styles.scss';

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
  const win = window.open(url);
  if (win) {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
};

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
 * - Debounced error state to avoid flickering during rapid re-renders
 *
 * @param props.code - Raw mermaid diagram source code to render.
 */
const MantineAIMMermaidCode = memo((props: { code: string }) => {
  const renderState = useMantineAIMarkdownRenderState();
  const isDark = renderState.colorScheme === 'dark';

  const ref = useRef<HTMLPreElement>(null);
  const [showOriginalCode, setShowOriginalCode] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [chartType, setChartType] = useState('unknown');

  const debouncedUpdateRenderError = useMemo(
    () =>
      debounce((error: boolean) => {
        setRenderError(error);
      }, 200),
    []
  );

  useEffect(() => {
    return () => {
      debouncedUpdateRenderError.cancel();
    };
  }, [debouncedUpdateRenderError]);

  useEffect(() => {
    if (props.code && ref.current) {
      const renderMermaid = async () => {
        try {
          debouncedUpdateRenderError(false);
          if (ref.current) {
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: 'loose',
              theme: isDark ? 'dark' : 'base',
              darkMode: isDark,
            });
            const parseResult = await mermaid.parse(props.code);
            if (!parseResult) {
              throw new Error('Failed to parse mermaid code');
            }
            const { svg, bindFunctions, diagramType } = await mermaid.render(
              generateMermaidUUID(),
              props.code,
              ref.current
            );
            ref.current.innerHTML = svg;
            bindFunctions?.(ref.current);
            setChartType(diagramType);
          }
        } catch {
          debouncedUpdateRenderError(true);
        }
      };

      renderMermaid();
    }
  }, [props.code, isDark, showOriginalCode, debouncedUpdateRenderError]);

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
                    key="gpt"
                    onClick={() => {
                      setShowOriginalCode(false);
                    }}
                  >
                    <Flex align="center" justify="center" w={18} h={18}>
                      <span className="icon-[gravity-ui--logo-mermaid] relative bottom-[1px] text-[16px]"></span>
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
                  <span className="icon-[entypo--code] relative bottom-[0.25px] text-[16px]"></span>
                </Flex>
              </ActionIcon>
            </Tooltip>
            <CopyButton value={props.code}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                  <ActionIcon variant="transparent" size={28} className="action-icon" onClick={copy}>
                    {copied ? (
                      <span className="icon-origin-[lucide--check] text-[18px]"></span>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        strokeWidth="2"
                        stroke="currentColor"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        width="18px"
                        height="18px"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                        <path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"></path>
                        <path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"></path>
                      </svg>
                    )}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Flex>
        </div>
        <pre
          ref={ref}
          style={{ cursor: 'pointer', overflow: 'auto', width: '100%', padding: '0.5rem' }}
          onClick={() => viewSvgInNewWindow()}
        />
      </div>
    </>
  );
});

MantineAIMMermaidCode.displayName = 'MantineAIMMermaidCode';

export default MantineAIMMermaidCode;
