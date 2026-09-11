// @vitest-environment jsdom
/**
 * Hydration of coordinated chunks (`<AIMarkdownDocuments>`, shared
 * `documentId`) when each chunk sits in its own `<Suspense>` boundary.
 *
 * The server renders every chunk with standalone semantics: a reference
 * whose definition lives in another chunk stays literal text. On the
 * client, a boundary that hydrates after its siblings have committed sees a
 * registry that those siblings' effects already populated. The hydration
 * render must still produce the server's bytes; the registry takes over
 * only after hydration completes. See `isHydratingServerHtml` in
 * crossChunkPlaceholders.tsx.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, Suspense, useLayoutEffect, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import AIMarkdown, { AIMarkdownDocuments } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHUNK_A = 'Intro.\n\n[^a]: Note';
const CHUNK_B = 'See[^a] and [link][x].';
const CHUNK_C = '[x]: https://example.com';
const LITERAL_B = '<p>See[^a] and [link][x].</p>';
const RESOLVED_B =
  '<p>See<sup><a href="#doc-user-content-fn-a" id="doc-user-content-fnref-a" data-footnote-ref="">1</a></sup> and <a href="https://example.com">link</a>.</p>';

/** Throws a promise while armed, so the Suspense boundary around chunk B
 *  stays dehydrated until the test releases it. The test arms the gate
 *  after the server pass (jsdom defines `window` during `renderToString`
 *  too, so the environment cannot tell the two passes apart). */
interface Gate {
  armed: boolean;
  promise: Promise<void>;
  release: () => void;
}
function createGate(): Gate {
  const gate: Gate = { armed: false, promise: Promise.resolve(), release: () => {} };
  gate.promise = new Promise<void>((resolve) => {
    gate.release = () => {
      gate.armed = false;
      resolve();
    };
  });
  return gate;
}
function Delay({ gate, children }: { gate: Gate | null; children: ReactNode }) {
  if (gate?.armed) throw gate.promise;
  return children;
}

function Document({ gate }: { gate: Gate | null }) {
  return (
    <AIMarkdownDocuments>
      <Suspense fallback={null}>
        <AIMarkdown content={CHUNK_A} documentId="doc" documentIndex={0} />
      </Suspense>
      <Suspense fallback={null}>
        <Delay gate={gate}>
          <AIMarkdown content={CHUNK_B} documentId="doc" documentIndex={1} />
        </Delay>
      </Suspense>
      <Suspense fallback={null}>
        <AIMarkdown content={CHUNK_C} documentId="doc" documentIndex={2} />
      </Suspense>
    </AIMarkdownDocuments>
  );
}

const chunkB = (container: HTMLElement) => container.querySelector('div:nth-of-type(2) p');

/** Let React run every pending hydration, effect and registry microtask. */
const settle = () => act(async () => {});

describe('coordinated chunks under Suspense: hydration', () => {
  const roots: Root[] = [];
  let container: HTMLElement;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount());
    }
    container.remove();
    consoleError.mockRestore();
  });

  test('server output leaves cross-chunk references literal', () => {
    const html = renderToString(<Document gate={null} />);
    expect(html).toContain(LITERAL_B);
    expect(html).not.toContain('data-footnote-ref');
  });

  test('a boundary that hydrates after its siblings have contributed hydrates clean, then resolves', async () => {
    const gate = createGate();
    container.innerHTML = renderToString(<Document gate={gate} />);
    const serverParagraph = chunkB(container);
    expect(serverParagraph?.outerHTML).toBe(LITERAL_B);
    gate.armed = true;

    const recoverable: unknown[] = [];
    await act(async () => {
      roots.push(
        hydrateRoot(container, <Document gate={gate} />, {
          onRecoverableError: (error) => recoverable.push(error),
        })
      );
    });
    await settle();

    // Chunks A and C are hydrated and their effects have registered their
    // labels; chunk B is still the server's dehydrated markup.
    expect(recoverable).toEqual([]);
    expect(chunkB(container)?.outerHTML).toBe(LITERAL_B);
    expect(container.querySelector('[data-footnotes]')).not.toBeNull();

    gate.release();
    await act(async () => {
      await gate.promise;
    });
    await settle();

    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    // The registry wins once hydration is done: the footnote mark and the
    // cross-chunk link resolve, and the server's <p> was hydrated in place
    // rather than regenerated.
    expect(chunkB(container)?.outerHTML).toBe(RESOLVED_B);
    expect(chunkB(container)).toBe(serverParagraph);
  });

  test('single-pass hydration hydrates clean and resolves', async () => {
    container.innerHTML = renderToString(<Document gate={null} />);
    const serverParagraph = chunkB(container);

    const recoverable: unknown[] = [];
    await act(async () => {
      roots.push(
        hydrateRoot(container, <Document gate={null} />, {
          onRecoverableError: (error) => recoverable.push(error),
        })
      );
    });
    await settle();

    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(chunkB(container)?.outerHTML).toBe(RESOLVED_B);
    expect(chunkB(container)).toBe(serverParagraph);
  });

  test('a client-only render commits the standalone frame first, then resolves after effects', async () => {
    const frames: string[] = [];
    // Layout effects run after every DOM mutation of the commit, so the
    // first one observes the first committed frame of the whole tree.
    function FirstFrame() {
      useLayoutEffect(() => {
        frames.push(chunkB(container)?.outerHTML ?? '');
      }, []);
      return null;
    }
    await act(async () => {
      const root = createRoot(container);
      roots.push(root);
      root.render(
        <>
          <Document gate={null} />
          <FirstFrame />
        </>
      );
    });
    await settle();

    expect(consoleError).not.toHaveBeenCalled();
    // The registry is populated by commit-time effects, so the first frame
    // is the standalone render; the resolved output follows in the same
    // act() once the effects have run.
    expect(frames).toEqual([LITERAL_B]);
    expect(chunkB(container)?.outerHTML).toBe(RESOLVED_B);
  });
});
