/**
 * Node-side contract of `useDocumentSmoothStream`: SSR output shape and
 * byte-identical degradation to `useSmoothStream`. The interactive gate
 * mechanics (release handshake, done reporting, sequencing) run through
 * real React commits and the coordinator microtask path — they are covered
 * by the Storybook browser suite (TurnTaking stories), same split as the
 * base hook.
 */
import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AIMarkdownDocuments } from '../AIMarkdownDocuments';
import { useSmoothStream } from './useSmoothStream';
import { useDocumentSmoothStream } from './useDocumentSmoothStream';

const CONTENT = 'Streaming **markdown** with a [ref][r] tail\n\n[r]: https://example.com\n';

/** Serialize a hook result so byte-equality compares the full contract. */
const Probe = ({ hook }: { hook: () => { content: string; streaming: boolean } }) => {
  const { content, streaming } = hook();
  // One concatenated expression — adjacent JSX text expressions get `<!-- -->`
  // separators in SSR output, which would garble the byte-equality checks.
  return <pre>{`${streaming}|${content}`}</pre>;
};

describe('useDocumentSmoothStream — degradation', () => {
  test('without documentId it renders byte-identically to useSmoothStream', () => {
    for (const streaming of [true, false]) {
      const wrapped = renderToString(<Probe hook={() => useDocumentSmoothStream({ content: CONTENT, streaming })} />);
      const plain = renderToString(<Probe hook={() => useSmoothStream({ content: CONTENT, streaming })} />);
      expect(wrapped).toBe(plain);
    }
  });

  test('outside <AIMarkdownDocuments> a documentId alone changes nothing', () => {
    const wrapped = renderToString(
      <Probe hook={() => useDocumentSmoothStream({ documentId: 'doc', content: CONTENT, streaming: true })} />
    );
    const plain = renderToString(<Probe hook={() => useSmoothStream({ content: CONTENT, streaming: true })} />);
    expect(wrapped).toBe(plain);
  });

  test('smoothTurnTaking={false} on the wrapper disables coordination wholesale', () => {
    // Two streaming chunks: with coordination off, the SECOND renders its
    // full content on the server instead of being gated to ''.
    const html = renderToString(
      <AIMarkdownDocuments smoothTurnTaking={false}>
        <Probe hook={() => useDocumentSmoothStream({ documentId: 'doc', content: CONTENT, streaming: true })} />
        <Probe hook={() => useDocumentSmoothStream({ documentId: 'doc', content: CONTENT, streaming: true })} />
      </AIMarkdownDocuments>
    );
    const one = renderToString(<Probe hook={() => useSmoothStream({ content: CONTENT, streaming: true })} />);
    expect(html).toBe(one + one);
  });
});

describe('useDocumentSmoothStream — SSR / first-frame gate decision', () => {
  test('a non-empty chunk passes through: full text on the server', () => {
    const html = renderToString(
      <AIMarkdownDocuments>
        <Probe hook={() => useDocumentSmoothStream({ documentId: 'doc', content: CONTENT, streaming: true })} />
      </AIMarkdownDocuments>
    );
    expect(html).toContain('Streaming');
    expect(html).toContain('true|'); // streaming passthrough, not forced false
  });

  test('a non-empty successor passes through even behind a streaming predecessor', () => {
    // The gate applies only to empty-content mounts: preloaded content must
    // never blank out (remount / hydration safety), regardless of position.
    const html = renderToString(
      <AIMarkdownDocuments>
        <Probe hook={() => useDocumentSmoothStream({ documentId: 'doc', content: CONTENT, streaming: true })} />
        <Probe hook={() => useDocumentSmoothStream({ documentId: 'doc', content: 'tail chunk', streaming: true })} />
      </AIMarkdownDocuments>
    );
    expect(html).toContain('tail chunk');
  });

  test('an empty streaming chunk renders empty and not-streaming (no cursor slot)', () => {
    const html = renderToString(
      <AIMarkdownDocuments>
        <Probe hook={() => useDocumentSmoothStream({ documentId: 'doc', content: '', streaming: true })} />
      </AIMarkdownDocuments>
    );
    // false|<empty> — the pending presentation. Matches the client's first
    // frame, so hydration sees identical output.
    expect(html).toContain('false|');
    expect(html).not.toContain('true|');
  });
});
