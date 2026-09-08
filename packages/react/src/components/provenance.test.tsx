import { describe, test, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { useState } from 'react';
import AIMarkdown from '../index';
import { AIMarkdownDocuments } from './AIMarkdownDocuments';
import { createCredential, useProvenanceCredential, PROVENANCE_FALLBACK_MESSAGE } from './provenance';

/** Count credential creations by the CSPRNG calls they make, and recover
 *  the produced values from the filled buffers — the module's own internal
 *  call is not interceptable through the export. */
function spyRandom() {
  const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
  const values = () =>
    spy.mock.calls.map(([buf]) =>
      Array.from(buf as Uint8Array)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  return { spy, values };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function coordinated(content: string) {
  return renderToString(
    <AIMarkdownDocuments>
      <AIMarkdown content={content} documentId="m" />
    </AIMarkdownDocuments>
  );
}

describe('provenance — forged placeholders never reach the placeholders', () => {
  test('a forged <footnote-sup> no longer captures the fnref anchor', () => {
    const html = coordinated('x <footnote-sup label="a"></footnote-sup> y');
    expect(html).not.toContain('fnref-a');
    expect(html).not.toContain('footnote-sup');
    expect(html).toContain('x');
    expect(html).toContain('y');
  });

  test('a forged <cross-chunk-link> renders as plain text, not a link', () => {
    const html = coordinated('x <cross-chunk-link label="l" localUrl="/p">evil</cross-chunk-link> y');
    expect(html).toContain('evil');
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toContain('cross-chunk-link');
  });

  test('a forged <cross-chunk-image> disappears', () => {
    const html = coordinated('x <cross-chunk-image label="i" alt="pwn" localUrl="/p.png"></cross-chunk-image> y');
    expect(html).not.toContain('pwn');
    expect(html).not.toMatch(/<img\b/);
  });

  test('genuine placeholders still render (local footnote mark and its footer)', () => {
    const html = coordinated('See [^a].\n\n[^a]: note');
    expect(html).toMatch(/<sup\b/);
    expect(html).toContain('note');
    expect(html).toContain('data-footnotes');
  });

  test('the credential value never reaches the rendered HTML', () => {
    const { spy, values } = spyRandom();
    const html = coordinated('See [^a] and [t][l].\n\n[^a]: note\n\n[l]: /x');
    expect(spy).toHaveBeenCalled();
    for (const v of values()) expect(html).not.toContain(v);
    expect(html).not.toContain('engineProvenance');
    expect(html).not.toContain('engineprovenance');
  });
});

describe('provenance — credential creation', () => {
  test('with Web Crypto: 32 hex chars, secret', () => {
    const c = createCredential();
    expect(c.secret).toBe(true);
    expect(c.value).toMatch(/^[0-9a-f]{32}$/);
    expect(createCredential().value).not.toBe(c.value);
  });

  test('without Web Crypto: unique non-secret value, one dev diagnostic per credential, nothing thrown', () => {
    vi.stubGlobal('crypto', undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = createCredential();
    const b = createCredential();
    expect(a.secret).toBe(false);
    expect(a.value).not.toBe('');
    expect(a.value).not.toBe(b.value);
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy.mock.calls[0][0]).toContain('[ai-react-markdown]');
    expect(errSpy.mock.calls[0][0]).toContain(PROVENANCE_FALLBACK_MESSAGE);
    // The diagnostic never carries the value itself.
    expect(errSpy.mock.calls[0][0]).not.toContain(a.value);
  });

  test('without Web Crypto, coordinated rendering still works and forged placeholders are still unwrapped (layer 1)', () => {
    vi.stubGlobal('crypto', undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = coordinated('See [^a]. <footnote-sup label="z"></footnote-sup>\n\n[^a]: note');
    expect(html).toMatch(/<sup\b/);
    expect(html).toContain('note');
    expect(html).not.toContain('fnref-z');
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  test('production build emits no diagnostic on the fallback path (module reset, env stubbed before import)', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('crypto', undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fresh = await import('./provenance');
      const c = fresh.createCredential();
      expect(c.secret).toBe(false);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      vi.resetModules();
    }
  });
});

describe('provenance — once per mounted component', () => {
  /** Re-renders ITSELF three times during one server render (render-phase
   *  state updates re-run the component with its hooks retained), which is
   *  the only re-render mechanism available without a DOM. The hook is the
   *  exact one `AIMarkdownContent` uses. */
  function Probe({ onValue }: { onValue: (v: string) => void }) {
    const cred = useProvenanceCredential();
    const [n, setN] = useState(0);
    if (n < 3) setN(n + 1);
    onValue(cred.value);
    return <span>{n}</span>;
  }

  test('the hook creates one credential across re-renders of the same mount', () => {
    const { spy } = spyRandom();
    const seen: string[] = [];
    const html = renderToString(<Probe onValue={(v) => seen.push(v)} />);
    expect(html).toContain('3');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('separate mounts get separate credentials; without Web Crypto each emits its own single diagnostic', () => {
    vi.stubGlobal('crypto', undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a: string[] = [];
    const b: string[] = [];
    renderToString(<Probe onValue={(v) => a.push(v)} />);
    renderToString(<Probe onValue={(v) => b.push(v)} />);
    expect(new Set(a).size).toBe(1);
    expect(new Set(b).size).toBe(1);
    expect(a[0]).not.toBe(b[0]);
    expect(errSpy).toHaveBeenCalledTimes(2);
  });
});

describe('provenance — SSR', () => {
  test('two concurrent server renders with different credentials produce identical HTML', () => {
    const { spy, values } = spyRandom();
    const content = 'See [^a] and [t][l].\n\n[^a]: note\n\n[l]: /x';
    const first = coordinated(content);
    const second = coordinated(content);
    expect(first).toBe(second);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const v = values();
    expect(new Set(v).size).toBe(v.length);
  });
});
