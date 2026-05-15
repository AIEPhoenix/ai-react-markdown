import { describe, test, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AIMarkdownDocuments, useDocumentRegistry, __internalGetContext } from './AIMarkdownDocuments';
import type { Registry } from './documentRegistry';

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
