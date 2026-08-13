'use client';

import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface UseStreamedContentOptions {
  chunkSizeMin?: number;
  chunkSizeMax?: number;
  chunkDelayMin?: number;
  chunkDelayMax?: number;
  /** Override the PRNG seed to get a different — but still repeatable — cadence. */
  seed?: number;
}

export interface StreamedContent {
  content: string;
  streaming: boolean;
  restart: () => void;
}

/**
 * Deterministic PRNG (mulberry32) — the same generator the benchmark
 * scenarios use. Chunk sizes and inter-chunk delays are jitter, not entropy:
 * seeding them means a replay produces the identical arrival pattern every
 * time, so a story that looks wrong can be looked at twice.
 */
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Default seed for `useStreamedContent`. */
export const STREAM_JITTER_SEED = 0x5eed1e;

const randInt = (random: () => number, min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;

export const useStreamedContent = (
  fullText: string,
  {
    chunkSizeMin = 2,
    chunkSizeMax = 8,
    chunkDelayMin = 15,
    chunkDelayMax = 60,
    seed = STREAM_JITTER_SEED,
  }: UseStreamedContentOptions = {}
): StreamedContent => {
  const [position, setPosition] = useState(0);
  const [generation, restart] = useReducer((n: number) => n + 1, 0);
  const randomRef = useRef<() => number>(mulberry32(seed));

  useEffect(() => {
    // Reset streaming position when the source text or generation counter changes.
    // This is a deliberate state-reset effect; eslint-plugin-react-hooks@7 flags
    // synchronous setState-in-effect as a cascade-render hazard, but here it's
    // the only correct way to reset *this* hook's local state when one of its
    // inputs changes from the outside. Storybook-demo code only.
    // Reseeding here (and not in the timer effect) is what makes a restart
    // replay the exact same cadence as the first run.
    randomRef.current = mulberry32(seed);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition(0);
  }, [fullText, generation, seed]);

  useEffect(() => {
    if (position >= fullText.length) return;
    const random = randomRef.current;
    const size = randInt(random, chunkSizeMin, chunkSizeMax);
    const delay = randInt(random, chunkDelayMin, chunkDelayMax);
    const id = window.setTimeout(() => {
      setPosition((prev) => Math.min(fullText.length, prev + size));
    }, delay);
    return () => window.clearTimeout(id);
  }, [position, fullText, chunkSizeMin, chunkSizeMax, chunkDelayMin, chunkDelayMax]);

  return {
    content: fullText.slice(0, position),
    streaming: position < fullText.length,
    restart,
  };
};

/**
 * Shared shell for the streaming demo stories (core and mantine): a replay
 * button above the streamed markdown. Each package styles its own button
 * (`renderButton`) and renders its own markdown component (`children`) —
 * what's shared is the hook wiring and the button-over-content layout, and,
 * because this is a real component (not a story `render` slot calling hooks
 * directly), consumers don't need a rules-of-hooks suppression.
 */
export const StreamingReplay = ({
  text,
  options,
  style,
  renderButton,
  children,
}: {
  /** Full markdown document to stream. */
  text: string;
  options?: UseStreamedContentOptions;
  /** Style for the wrapping div (e.g. theme text color). */
  style?: CSSProperties;
  renderButton: (streaming: boolean, restart: () => void) => ReactNode;
  children: (content: string, streaming: boolean) => ReactNode;
}) => {
  const { content, streaming, restart } = useStreamedContent(text, options);
  return (
    <div style={style}>
      {renderButton(streaming, restart)}
      {children(content, streaming)}
    </div>
  );
};

export const STREAMING_DEMO_CONTENT = `# Streaming Demo

A live render of **streaming markdown**, with the same incomplete-token edge cases an LLM would emit:

- Inline math like $E = mc^2$
- Block math:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

- Fenced code:

\`\`\`ts
const fib = (n: number): number => (n < 2 ? n : fib(n - 1) + fib(n - 2));
\`\`\`

- Tables:

| Language | Released |
| -------- | -------- |
| JavaScript | 1995 |
| Rust | 2010 |

> The hard part of streaming markdown is handling **incomplete tokens** — code fences, LaTeX delimiters, and table rows mid-emission. Watch this render hold its shape as bytes arrive.
`;
