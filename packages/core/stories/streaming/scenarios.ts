export interface ScenarioConfig {
  description: string;
  hypothesis: string;
  label: string;
  /** Returns a cancel function. */
  run: (push: (chunk: string) => void, done: () => void) => () => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const DEFAULT_BLOCKS = [
  '# Stress payload\n\n',
  'Streaming markdown with mixed token boundaries — code, math, tables, admonitions — all incomplete during transit.\n\n',
  '```ts\nconst fib = (n: number): number => (n < 2 ? n : fib(n - 1) + fib(n - 2));\nconst result = Array.from({ length: 12 }, (_, i) => fib(i));\n```\n\n',
  '$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n\n',
  'Inline math like $E = mc^2$ and $\\frac{a}{b}$ keeps appearing.\n\n',
  '| Lang | Year | Stable |\n| --- | --- | --- |\n| JavaScript | 1995 | yes |\n| TypeScript | 2012 | yes |\n| Rust | 2010 | yes |\n\n',
  '> The hard part is **incomplete tokens** — code fences, LaTeX delimiters, table rows mid-emission.\n\n',
  '- bullet one with `inline code`\n- bullet two with [link](https://example.com)\n- bullet three closes the test payload.\n',
];

export const DEFAULT_PAYLOAD = DEFAULT_BLOCKS.join('');

const splitBlocks = (payload: string): string[] => {
  const parts = payload.split(/(\n\n+)/);
  const blocks: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i];
    const sep = parts[i + 1] ?? '';
    if (text) blocks.push(text + sep);
  }
  return blocks.length ? blocks : [payload];
};

export const buildScenarios = (payload: string): Record<string, ScenarioConfig> => {
  const fullPayload = payload || DEFAULT_PAYLOAD;
  const blocks = splitBlocks(fullPayload);
  return SCENARIO_FACTORIES_FROM(fullPayload, blocks);
};

const SCENARIO_FACTORIES_FROM = (
  fullPayload: string,
  blocks: string[],
): Record<string, ScenarioConfig> => ({
  largeAppend: {
    label: 'A. Single large append',
    description:
      'Push the entire markdown payload in one setState (~600 chars). Forces the renderer to consume every block in a single commit.',
    hypothesis: 'Worst-case for commit time — should produce one large commit + one large paint.',
    run: (push, done) => {
      let cancelled = false;
      const t = setTimeout(() => {
        if (cancelled) return;
        push(fullPayload);
        done();
      }, 50);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    },
  },

  blockBurst: {
    label: 'B. One markdown block / 500ms',
    description: 'Push one full markdown block per 500ms. Each push births a new top-level block.',
    hypothesis: 'New-block path stress — should show steady commits with no FPS dips.',
    run: (push, done) => {
      let cancelled = false;
      let i = 0;
      (async () => {
        while (!cancelled && i < blocks.length) {
          push(blocks[i++]);
          await sleep(500);
        }
        if (!cancelled) done();
      })();
      return () => {
        cancelled = true;
      };
    },
  },

  fastSmall: {
    label: 'C. 100 cps, 4-char chunks',
    description: '4-char chunk every 40ms. No chunk is large but boundary crossings are frequent.',
    hypothesis: 'High commit frequency — checks scheduler / batching efficiency.',
    run: (push, done) => {
      let cancelled = false;
      let pos = 0;
      (async () => {
        while (!cancelled && pos < fullPayload.length) {
          const size = Math.min(4, fullPayload.length - pos);
          push(fullPayload.slice(pos, pos + size));
          pos += size;
          await sleep(40);
        }
        if (!cancelled) done();
      })();
      return () => {
        cancelled = true;
      };
    },
  },

  ultraFast: {
    label: 'D. ~260 cps, 13-char chunks',
    description: '13-char chunk every 50ms. Sustained high-pressure stream — closest to a real GPT-4 turbo emit.',
    hypothesis: 'If commit time grows non-linearly in content size, this is where it shows.',
    run: (push, done) => {
      let cancelled = false;
      let pos = 0;
      (async () => {
        while (!cancelled && pos < fullPayload.length) {
          const size = Math.min(13, fullPayload.length - pos);
          push(fullPayload.slice(pos, pos + size));
          pos += size;
          await sleep(50);
        }
        if (!cancelled) done();
      })();
      return () => {
        cancelled = true;
      };
    },
  },

  slowSteady: {
    label: 'E. 20 cps baseline',
    description: '2-char chunks every 100ms. Slow, steady — baseline for what "smooth" should look like.',
    hypothesis: 'Should animate cleanly with sub-1ms commits.',
    run: (push, done) => {
      let cancelled = false;
      let pos = 0;
      (async () => {
        while (!cancelled && pos < fullPayload.length) {
          const size = Math.min(2, fullPayload.length - pos);
          push(fullPayload.slice(pos, pos + size));
          pos += size;
          await sleep(100);
        }
        if (!cancelled) done();
      })();
      return () => {
        cancelled = true;
      };
    },
  },

  randomTokens: {
    label: 'F. Random LLM-shaped tokens',
    description: 'Random chunk size 2–8 chars + random delay 15–60ms. Mimics real LLM token jitter.',
    hypothesis: 'The most realistic profile — what a chat UI will actually face.',
    run: (push, done) => {
      const randInt = (min: number, max: number) =>
        Math.floor(Math.random() * (max - min + 1)) + min;
      let cancelled = false;
      let pos = 0;
      (async () => {
        while (!cancelled && pos < fullPayload.length) {
          const size = Math.min(randInt(2, 8), fullPayload.length - pos);
          push(fullPayload.slice(pos, pos + size));
          pos += size;
          await sleep(randInt(15, 60));
        }
        if (!cancelled) done();
      })();
      return () => {
        cancelled = true;
      };
    },
  },
});

export const SCENARIO_KEYS = [
  'largeAppend',
  'blockBurst',
  'fastSmall',
  'ultraFast',
  'slowSteady',
  'randomTokens',
] as const;

export type ScenarioKey = (typeof SCENARIO_KEYS)[number];
