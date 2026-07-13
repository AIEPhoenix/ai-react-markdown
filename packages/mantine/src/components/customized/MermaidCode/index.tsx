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
 * - Preserves the last successful render across transient parse failures
 *
 * ## Streaming contract
 *
 * While `streaming` is true (from render state), the code prop is usually a
 * truncated prefix of the final diagram, so parse failures are *expected*,
 * not exceptional:
 * - Before the first successful render, the raw source is shown as a plain
 *   code block (never the error tab).
 * - After a success, the last good SVG stays up; each subsequent chunk is
 *   re-attempted and the diagram refreshes only on the next success.
 * - When streaming ends (`streaming` is an effect dep), one corrective pass
 *   runs on the final code: success refreshes the diagram, failure surfaces
 *   the real error tab — even over a previously rendered mid-stream diagram,
 *   because that diagram no longer matches the final source. The pending
 *   corrective obligation is tracked by `needsCorrectiveRef` (armed on the
 *   streaming→false edge, consumed by the next completed attempt), so ONLY
 *   that one pass may clobber a rendered diagram; any later failure (e.g. a
 *   transient throw on a theme-flip re-render) falls back to the static rule
 *   below.
 * - A streaming→true edge marks a NEW generation (chat "regenerate" reuses
 *   the same component instance when the block's source offset — and thus
 *   its React key — is unchanged). All per-generation state is reset so the
 *   warm-up shows the new source instead of the previous generation's stale
 *   diagram or error tab.
 *
 * ## Static contract (`streaming` stays false)
 *
 * Without streaming edges, failures follow the original conservative rule:
 * the error tab shows only while nothing has rendered yet. Once a diagram is
 * up, later failures (theme-flip re-render, a not-yet-complete `code` update
 * from a consumer that didn't pass `streaming`) keep the last good diagram
 * instead of clobbering it with an error.
 *
 * @param props.code - Raw mermaid diagram source code to render.
 */
const MantineAIMMermaidCode = memo((props: { code: string }) => {
  const renderState = useMantineAIMarkdownRenderState();
  const isDark = renderState.colorScheme === 'dark';
  const streaming = renderState.streaming;

  const ref = useRef<HTMLPreElement>(null);
  const renderVersionRef = useRef(0);
  /** Mirrors `hasRendered` for reads inside the async render closure —
   *  state reads there can be stale when deps change mid-flight. */
  const hasRenderedRef = useRef(false);
  /** Previous `streaming` value, for edge detection in the effect. */
  const prevStreamingRef = useRef(false);
  /** Armed on the streaming→false edge: the next completed render attempt is
   *  the end-of-stream corrective pass, whose failure must surface even over
   *  a rendered diagram. Consumed (reset) by that attempt's success OR
   *  surfaced failure, so later unrelated failures can't clobber the SVG. */
  const needsCorrectiveRef = useRef(false);
  const [hasRendered, setHasRendered] = useState(false);
  const [showOriginalCode, setShowOriginalCode] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [chartType, setChartType] = useState('unknown');

  useEffect(() => {
    // Streaming edge detection MUST run before any early return — the first
    // chunk of a new stream can arrive while the code is still empty.
    if (streaming && !prevStreamingRef.current) {
      // Rising edge = a new generation is starting on this same instance
      // (same block offset → same React key → no remount on regenerate).
      // Reset all per-generation state so warm-up shows the incoming source,
      // not the previous generation's stale diagram or error tab. Everything
      // here is idempotent — a StrictMode double-run is harmless.
      hasRenderedRef.current = false;
      needsCorrectiveRef.current = false;
      // Deliberate state reset on an input edge (same pattern as a
      // key-less "derived reset"); all three are no-ops when already at
      // their initial values, so steady-state chunks don't re-render.
      setHasRendered(false);
      setRenderError(false);
      setChartType('unknown');
      if (ref.current) {
        ref.current.innerHTML = '';
      }
    } else if (!streaming && prevStreamingRef.current) {
      // Falling edge = the stream just ended; arm the corrective pass.
      needsCorrectiveRef.current = true;
    }
    prevStreamingRef.current = streaming;
    if (!props.code || !ref.current || showOriginalCode) {
      return;
    }

    const renderVersion = ++renderVersionRef.current;
    let cancelled = false;

    const renderMermaid = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'base',
          darkMode: isDark,
          // Without a svgContainingElement, a draw-phase throw (an error that
          // got past mermaid.parse) leaves mermaid's temp element orphaned in
          // document.body — its error path only cleans up when this flag is
          // set. We render our own error tab anyway, so mermaid's built-in
          // error diagram is dead weight here regardless.
          suppressErrorRendering: true,
        });
        const parseResult = await mermaid.parse(props.code);
        if (!parseResult) {
          throw new Error('Failed to parse mermaid code');
        }

        if (!ref.current || cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }

        // Deliberately NOT passing `ref.current` as mermaid's
        // svgContainingElement: before the first success the host container
        // is hidden with `display: none` (source fallback is showing), and
        // mermaid measures text via getBBox during render — inside a
        // display:none subtree layout never runs, every measurement is 0,
        // and the diagram comes out as a ~16px SVG. With the argument
        // omitted, mermaid renders in a temp element appended to
        // `document.body` (its default path, cleaned up internally), so
        // measurement works no matter what our container is doing. The SVG
        // string is written into our own <pre> below either way.
        const { svg, bindFunctions, diagramType } = await mermaid.render(generateMermaidUUID(), props.code);
        if (!ref.current || cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }

        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
        hasRenderedRef.current = true;
        needsCorrectiveRef.current = false;
        setHasRendered(true);
        setChartType(diagramType);
        setRenderError(false);
      } catch {
        if (cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }
        // Mid-stream failures are expected (truncated code) — keep the last
        // good diagram / source placeholder and wait for more bytes. The
        // corrective pass after streaming ends reports real errors.
        if (streaming) {
          return;
        }
        // End-of-stream corrective pass: the final source no longer renders,
        // so the error must surface even over a mid-stream diagram. Consume
        // the obligation so later unrelated failures don't inherit it.
        if (needsCorrectiveRef.current) {
          needsCorrectiveRef.current = false;
          setChartType('unknown');
          setRenderError(true);
          return;
        }
        // Static rule: never clobber a rendered diagram (theme-flip
        // re-renders, un-flagged code updates from static consumers).
        if (hasRenderedRef.current) {
          return;
        }
        setChartType('unknown');
        setRenderError(true);
      }
    };

    void renderMermaid();

    return () => {
      cancelled = true;
    };
    // `streaming` in the deps is what drives the end-of-stream corrective
    // pass: the flip to false re-runs this effect on the (unchanged) final
    // code, so the last state reflects the full diagram source.
  }, [props.code, isDark, showOriginalCode, streaming]);

  const viewSvgInNewWindow = useCallback(() => {
    handleViewSVGInNewWindow(ref.current?.querySelector('svg'), isDark);
  }, [isDark]);

  // Show the raw source instead of the diagram container when the user asked
  // for it, when the (post-stream) render failed, or before the first
  // successful render (SSR output and the streaming warm-up phase). The
  // diagram container below stays MOUNTED throughout — merely hidden — so
  // `ref` is always available for mermaid to render into; unmounting it would
  // make the effect's `!ref.current` guard bail forever.
  const showSourceFallback = showOriginalCode || renderError || !hasRendered;

  return (
    <>
      {showSourceFallback && (
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
            // The "Render Mermaid" control only makes sense as the way back
            // from the user-toggled source view. In the error and warm-up
            // fallbacks `showOriginalCode` is already false, so the control
            // would be a no-op — hide it there. (No `!renderError` conjunct:
            // the toggle is only reachable from the visible diagram view,
            // and while the source view is open the effect early-returns,
            // so showOriginalCode && renderError is unreachable.)
            showOriginalCode
              ? [
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
              : []
          }
          withBorder
          withExpandButton
        />
      )}
      <div
        className={`aim-mantine-mermaid-code ${isDark ? 'dark' : ''}`}
        style={
          showSourceFallback
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
        <pre ref={ref} style={PRE_STYLE} onClick={viewSvgInNewWindow} />
      </div>
    </>
  );
});

MantineAIMMermaidCode.displayName = 'MantineAIMMermaidCode';

export default MantineAIMMermaidCode;
