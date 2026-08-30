/**
 * The `@ai-react-markdown/mantine` benchmark app.
 *
 * Same rule as its sibling: THE INTEGRATION IS THE README'S, VERBATIM —
 * `MantineProvider` wrapping `CodeHighlightAdapterProvider` wrapping
 * `MantineAIMarkdown`, with the four stylesheets in the documented order.
 * Instrumentation goes around it, never between the providers and the
 * renderer.
 *
 * This app exists as a SEPARATE app rather than a prop on the core one
 * because the difference between them is the whole point of having both: the
 * mantine variant pulls in Mantine's provider tree, a highlight.js adapter
 * and three more stylesheets, and the cost of that is a number someone will
 * eventually want. Sharing one app and branching inside it would put both
 * dependency graphs in both bundles and make each measurement describe the
 * other.
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '@ai-react-markdown/mantine';

import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ai-react-markdown/mantine/styles.css';
import 'katex/dist/katex.min.css';

import { driveScenario, installHarness, scenarioById, scriptedScroll, SCENARIOS } from '@bench/kit';

const APP = 'react-mantine';
const CONTAINER_ID = 'bench-container';

/** Built once at module scope, exactly as the README shows — building it per
 *  render would be our own mistake showing up as the library's cost. */
const highlightJsAdapter = createHighlightJsAdapter(hljs);

function Bench({ scenarioId }: { scenarioId: string }): React.ReactElement {
  const scenario = scenarioById(scenarioId);
  const [content, setContent] = useState('');
  const installed = useRef(false);

  useEffect(() => {
    if (scenario === undefined || installed.current) return;
    installed.current = true;

    installHarness({
      app: APP,
      scenario: scenario.id,
      container: () => document.getElementById(CONTAINER_ID),
      chunks: scenario.chunks.length,
      trackAnchor: scenario.trackAnchor === true,
      disableScrollAnchoring: new URLSearchParams(window.location.search).get('grow') === 'above',
      growAboveControl: new URLSearchParams(window.location.search).get('grow') === 'above',
      onScroll: scenario.after === 'scroll' ? () => scriptedScroll() : undefined,
    });

    window.__bench?.start();
    const handle = driveScenario(
      scenario,
      (next) => setContent(next),
      () => window.__bench?.onDrained(),
      {
        handicapMs: Number(new URLSearchParams(window.location.search).get('handicap') ?? 0),
      }
    );
    return () => handle.cancel();
  }, [scenario]);

  if (scenario === undefined) {
    return (
      <main>
        <h1>Pick a scenario</h1>
        <ul>
          {SCENARIOS.map((s) => (
            <li key={s.id}>
              <a href={`?scenario=${s.id}`}>{s.id}</a> — {s.title}
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
        <div id={CONTAINER_ID}>
          <MantineAIMarkdown content={content} />
        </div>
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}

declare global {
  interface Window {
    __benchScenarios?: string[];
    /** Chunk count of the CURRENT scenario. The self-test needs it to turn a
     *  per-chunk handicap into a total budget, and reading it from the app
     *  keeps `kit/scenarios.ts` the only place that knows. */
    __benchChunks?: number | null;
    /** Byte length of this scenario's document, for the scale fit. */
    __benchBytes?: number | null;
  }
}
window.__benchScenarios = SCENARIOS.map((s) => s.id);

const scenarioId = new URLSearchParams(window.location.search).get('scenario') ?? '';
window.__benchChunks = scenarioById(scenarioId)?.chunks.length ?? null;
window.__benchBytes = scenarioById(scenarioId)?.content.length ?? null;
const root = createRoot(document.getElementById('root') as HTMLElement);

if (scenarioId === '') {
  root.render(
    <StrictMode>
      <Bench scenarioId="" />
    </StrictMode>
  );
} else {
  root.render(<Bench scenarioId={scenarioId} />);
}
