/**
 * The NULL RENDERER — the floor every other app is measured against.
 *
 * It runs the identical harness over the identical scenarios and renders the
 * content into a `<pre>`. No markdown parse, no plugins, no components. Its
 * numbers are therefore the cost of everything that is NOT the renderer: the
 * scenario's own string slicing, the MessageChannel dispatch, React's state
 * update and commit for one text node, and the browser's rendering pipeline.
 *
 * It exists because of a hole this suite had for a day and could not see.
 * Every timing metric here rewards doing less work, so a renderer that
 * silently rendered NOTHING would post the best numbers in the table, and
 * nothing in the runner, the self-test or the comparison tool would object —
 * `renderedNodes: 0` compared favourably against a real count. A floor makes
 * that impossible to mistake for a win: a real app must be meaningfully
 * slower than this, and the self-test asserts it.
 *
 * It is also the only way to read `throughput-*` honestly. Those cells
 * deliver as fast as the event loop allows, so a share of their duration is
 * harness overhead rather than rendering. Subtracting this floor is what
 * turns "core streams 30KB in 328ms" into a statement about the renderer.
 *
 * NOT a performance target. Nothing here should ever be optimised toward
 * this number; it is a control, and a control that people start tuning
 * against has stopped being one.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { driveScenario, installHarness, scenarioById, scriptedScroll, SCENARIOS } from '@bench/kit';

const APP = 'react-null';
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
        <h1>Null renderer — the control</h1>
        <ul>
          {SCENARIOS.map((s) => (
            <li key={s.id}>
              <a href={`?scenario=${s.id}`}>{s.id}</a>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  // One text node. `white-space: pre-wrap` so the document still has a
  // realistic height and the scroll arm has somewhere to go.
  return (
    <div id={CONTAINER_ID}>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content}</pre>
    </div>
  );
}

declare global {
  interface Window {
    __benchScenarios?: string[];
    __benchChunks?: number | null;
  }
}
window.__benchScenarios = SCENARIOS.map((s) => s.id);

const scenarioId = new URLSearchParams(window.location.search).get('scenario') ?? '';
window.__benchChunks = scenarioById(scenarioId)?.chunks.length ?? null;
createRoot(document.getElementById('root') as HTMLElement).render(<Bench scenarioId={scenarioId} />);
