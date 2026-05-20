'use client';

import { useEffect, useReducer, useState } from 'react';

export interface UseStreamedContentOptions {
  chunkSizeMin?: number;
  chunkSizeMax?: number;
  chunkDelayMin?: number;
  chunkDelayMax?: number;
}

export interface StreamedContent {
  content: string;
  streaming: boolean;
  restart: () => void;
}

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export const useStreamedContent = (
  fullText: string,
  { chunkSizeMin = 2, chunkSizeMax = 8, chunkDelayMin = 15, chunkDelayMax = 60 }: UseStreamedContentOptions = {}
): StreamedContent => {
  const [position, setPosition] = useState(0);
  const [generation, restart] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    // Reset streaming position when the source text or generation counter changes.
    // This is a deliberate state-reset effect; eslint-plugin-react-hooks@7 flags
    // synchronous setState-in-effect as a cascade-render hazard, but here it's
    // the only correct way to reset *this* hook's local state when one of its
    // inputs changes from the outside. Storybook-demo code only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition(0);
  }, [fullText, generation]);

  useEffect(() => {
    if (position >= fullText.length) return;
    const size = randInt(chunkSizeMin, chunkSizeMax);
    const delay = randInt(chunkDelayMin, chunkDelayMax);
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
