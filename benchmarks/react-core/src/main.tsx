/**
 * The `@ai-react-markdown/core` benchmark app.
 *
 * THE INTEGRATION IS THE README'S, VERBATIM. The three lines below —
 * two stylesheet imports and `<AIMarkdown content={...} />` — are copied
 * from the package README's quick start, and they are the whole contract
 * being measured. Everything else in this file is scaffolding placed AROUND
 * that, never between it and React.
 *
 * That rule is what makes the numbers mean anything. The moment this file
 * starts memoising the content, batching the updates, or wrapping the
 * renderer in something a user would not write, the benchmark stops
 * describing the library and starts describing our cleverness — and the
 * regression it would then fail to catch is precisely the one a user hits.
 *
 * The dependency is `workspace:*`, which resolves through the package's own
 * `exports` to its built `dist`. That is the same entry point npm would
 * hand a user; it is not a source-level import, and it must not become one.
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import AIMarkdown from '@ai-react-markdown/core';
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';

import { driveScenario, installHarness, scenarioById, scriptedScroll, SCENARIOS } from '@bench/kit';

const APP = 'react-core';
const CONTAINER_ID = 'bench-container';

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
      onScroll: scenario.after === 'scroll' ? () => scriptedScroll() : undefined,
    });

    window.__bench?.start();
    const handle = driveScenario(
      scenario,
      (next) => setContent(next),
      () => window.__bench?.onDrained(),
      { handicapMs: Number(new URLSearchParams(window.location.search).get('handicap') ?? 0) }
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
    <div id={CONTAINER_ID}>
      <AIMarkdown content={content} />
    </div>
  );
}

// The runner reads its work list from here rather than keeping its own copy,
// so `kit/scenarios.ts` stays the single definition. A scenario added there
// is picked up by the next run with no second edit.
declare global {
  interface Window {
    __benchScenarios?: string[];
    /** Chunk count of the CURRENT scenario. The self-test needs it to turn a
     *  per-chunk handicap into a total budget, and reading it from the app
     *  keeps `kit/scenarios.ts` the only place that knows. */
    __benchChunks?: number | null;
  }
}
window.__benchScenarios = SCENARIOS.map((s) => s.id);

const scenarioId = new URLSearchParams(window.location.search).get('scenario') ?? '';
window.__benchChunks = scenarioById(scenarioId)?.chunks.length ?? null;
const root = createRoot(document.getElementById('root') as HTMLElement);

/**
 * NO StrictMode when a scenario is running, and the reason is a measurement
 * fact rather than a style preference: StrictMode double-invokes effects and
 * renders in development, and while a production build drops that, keeping
 * the two paths identical avoids a class of "why is the index page different"
 * confusion. The index page keeps it because that path is not measured.
 */
if (scenarioId === '') {
  root.render(
    <StrictMode>
      <Bench scenarioId="" />
    </StrictMode>
  );
} else {
  root.render(<Bench scenarioId={scenarioId} />);
}
