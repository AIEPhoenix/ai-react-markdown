import { describe, test, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AIMarkdownDocuments, useDocumentRegistry, __internalGetContext } from './AIMarkdownDocuments';
import type { Registry } from '@ai-react-markdown/engine';
import * as registryModule from '@ai-react-markdown/engine';
import { FootnoteSupNumber } from './crossChunkPlaceholders';
import AIMarkdownProvider from '../context';

describe('<AIMarkdownDocuments>', () => {
  test('renders children', () => {
    const html = renderToString(
      <AIMarkdownDocuments>
        <div data-testid="child">hi</div>
      </AIMarkdownDocuments>
    );
    expect(html).toContain('data-testid="child"');
    expect(html).toContain('hi');
  });

  test('useDocumentRegistry returns null outside wrapper', () => {
    let captured: Registry | null | undefined;
    function Probe() {
      // eslint-disable-next-line react-hooks/globals -- test-probe pattern captures the hook's return value into a closure-local for assertion after renderToString returns.
      captured = useDocumentRegistry('docX');
      return null;
    }
    renderToString(<Probe />);
    expect(captured).toBeNull();
  });

  test('useDocumentRegistry returns registry inside wrapper', () => {
    let captured: Registry | null | undefined;
    function Probe() {
      // eslint-disable-next-line react-hooks/globals -- test-probe pattern captures the hook's return value into a closure-local for assertion after renderToString returns.
      captured = useDocumentRegistry('docX');
      return null;
    }
    renderToString(
      <AIMarkdownDocuments>
        <Probe />
      </AIMarkdownDocuments>
    );
    expect(captured).not.toBeNull();
    expect(captured!.chunkOrder).toEqual([]);
  });

  test('nested <AIMarkdownDocuments> throws in dev', () => {
    // Default vitest env is `NODE_ENV=test`, which our `!= production` check
    // treats the same as `development` — fail fast so the misuse surfaces in
    // local + CI builds.
    expect(() =>
      renderToString(
        <AIMarkdownDocuments>
          <AIMarkdownDocuments>
            <div />
          </AIMarkdownDocuments>
        </AIMarkdownDocuments>
      )
    ).toThrow(/nested/i);
  });

  test('nested <AIMarkdownDocuments> in prod logs and renders the inner subtree', () => {
    // Production builds degrade gracefully — an upstream composition bug
    // (RSC, portal, third-party layout) that nests the wrapper would
    // otherwise crash an entire conversation pane. Verify:
    //   1. No throw.
    //   2. `console.error` is called with the canonical message.
    //   3. The inner subtree still renders (the outer Provider remains in
    //      effect, so `children` are spread as-is).
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const html = renderToString(
        <AIMarkdownDocuments>
          <AIMarkdownDocuments>
            <div data-testid="inner">survived</div>
          </AIMarkdownDocuments>
        </AIMarkdownDocuments>
      );
      // Inner subtree rendered.
      expect(html).toContain('data-testid="inner"');
      expect(html).toContain('survived');
      // Error logged exactly once with the canonical text.
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls[0][0]).toMatch(/must not be nested/i);
      expect(errSpy.mock.calls[0][0]).toMatch(/\[ai-react-markdown\]/);
    } finally {
      vi.unstubAllEnvs();
      errSpy.mockRestore();
    }
  });

  test('useDocumentRegistry returns null if documentId is undefined', () => {
    let captured: Registry | null | undefined;
    function Probe() {
      // eslint-disable-next-line react-hooks/globals -- test-probe pattern; see above.
      captured = useDocumentRegistry(undefined);
      return null;
    }
    renderToString(
      <AIMarkdownDocuments>
        <Probe />
      </AIMarkdownDocuments>
    );
    expect(captured).toBeNull();
  });

  test('useDocumentRegistry returns null for a non-explicit (auto-generated) id inside wrapper', () => {
    // The crux of the standalone-vs-coordinated split: a chunk that did NOT
    // receive a documentId gets an auto-generated useId fallback. Even though
    // that fallback is a perfectly good non-empty string AND the chunk sits
    // inside <AIMarkdownDocuments>, it must NOT register into a registry —
    // its id is unique by construction, so coordination is meaningless and the
    // standalone (registry === null) path should be taken.
    let captured: Registry | null | undefined;
    function Probe() {
      // eslint-disable-next-line react-hooks/globals -- test-probe pattern; see above.
      captured = useDocumentRegistry('_r_auto_0_', /* documentIdExplicit */ false);
      return null;
    }
    renderToString(
      <AIMarkdownDocuments>
        <Probe />
      </AIMarkdownDocuments>
    );
    expect(captured).toBeNull();
  });

  test('useDocumentRegistry returns a registry for an explicit id inside wrapper', () => {
    // The mirror case: an explicitly-supplied id opts into coordination.
    let captured: Registry | null | undefined;
    function Probe() {
      // eslint-disable-next-line react-hooks/globals -- test-probe pattern; see above.
      captured = useDocumentRegistry('docX', /* documentIdExplicit */ true);
      return null;
    }
    renderToString(
      <AIMarkdownDocuments>
        <Probe />
      </AIMarkdownDocuments>
    );
    expect(captured).not.toBeNull();
  });

  test('registry is evicted from the wrapper map after its last chunk releases', async () => {
    // Long-lived SPAs that cycle through many distinct documentIds would
    // accumulate empty registry shells without eviction. The wrapper hands
    // each registry an onEmpty callback that drops the Map entry when the
    // registry transitions to "no chunks alive". Verified by observing
    // that getRegistry returns a FRESH Registry instance after eviction.
    let ctx: ReturnType<typeof __internalGetContext> = null;
    function CapturedCtx() {
      ctx = __internalGetContext();
      return null;
    }
    renderToString(
      <AIMarkdownDocuments>
        <CapturedCtx />
      </AIMarkdownDocuments>
    );
    expect(ctx).not.toBeNull();

    const regA = ctx!.getRegistry('docA');
    regA.allocateSymbol('chunk1');
    // Same id returns same registry while a chunk is alive.
    expect(ctx!.getRegistry('docA')).toBe(regA);

    regA.releaseSymbol('chunk1');
    await new Promise<void>((r) => queueMicrotask(r));

    // Post-eviction: a fresh getRegistry call creates a NEW Registry.
    const regAfresh = ctx!.getRegistry('docA');
    expect(regAfresh).not.toBe(regA);
    // The fresh one really is fresh — no leftover chunkData.
    expect(regAfresh.chunkOrder).toEqual([]);
  });

  test('eviction does not affect a sibling documentId with live chunks', async () => {
    let ctx: ReturnType<typeof __internalGetContext> = null;
    function CapturedCtx() {
      ctx = __internalGetContext();
      return null;
    }
    renderToString(
      <AIMarkdownDocuments>
        <CapturedCtx />
      </AIMarkdownDocuments>
    );
    const regA = ctx!.getRegistry('docA');
    const regB = ctx!.getRegistry('docB');
    regA.allocateSymbol('a1');
    regB.allocateSymbol('b1');
    regA.releaseSymbol('a1');
    await new Promise<void>((r) => queueMicrotask(r));
    // docA evicted; docB still alive.
    expect(ctx!.getRegistry('docA')).not.toBe(regA);
    expect(ctx!.getRegistry('docB')).toBe(regB);
  });

  // ── End-to-end: the original bug's real scenario ────────────────────────
  // A genuine placeholder component (not a synthetic probe) rendered under the
  // real render-state provider inside <AIMarkdownDocuments>. The observable
  // side effect of "did this chunk join the registry?" is whether the wrapper
  // had to CREATE a registry — getRegistry is lazy, so `createRegistry` firing
  // is a faithful, output-independent witness (the bug has no visible output
  // difference; only the registry-shell side effect distinguishes the paths).
  test('placeholder under wrapper takes standalone (never creates a registry) for an auto-generated id', () => {
    const spy = vi.spyOn(registryModule, 'createRegistry');
    try {
      renderToString(
        <AIMarkdownDocuments>
          {/* documentId omitted ⇒ documentIdExplicit=false ⇒ standalone */}
          <AIMarkdownProvider streaming={false} fontSize="14px" variant="default" colorScheme="light">
            <FootnoteSupNumber label="x" />
          </AIMarkdownProvider>
        </AIMarkdownDocuments>
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      // Restore in `finally` so a failed assertion doesn't leak the spy into
      // later tests (matches the try/finally hygiene of the prod-nesting test).
      spy.mockRestore();
    }
  });

  test('placeholder under wrapper DOES open a registry for an explicit id (positive control)', () => {
    const spy = vi.spyOn(registryModule, 'createRegistry');
    try {
      renderToString(
        <AIMarkdownDocuments>
          <AIMarkdownProvider
            streaming={false}
            fontSize="14px"
            variant="default"
            colorScheme="light"
            documentId="msg-1"
          >
            <FootnoteSupNumber label="x" />
          </AIMarkdownProvider>
        </AIMarkdownDocuments>
      );
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('preserveOrphanReferences prop default is true', () => {
    let captured: boolean | null = null;
    function Probe() {
      const ctx = __internalGetContext();
      captured = ctx?.preserveOrphanReferences ?? null;
      return null;
    }
    renderToString(
      <AIMarkdownDocuments>
        <Probe />
      </AIMarkdownDocuments>
    );
    expect(captured).toBe(true);
  });
});
