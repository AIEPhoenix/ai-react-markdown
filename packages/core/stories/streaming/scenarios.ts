export interface ScenarioConfig {
  description: string;
  hypothesis: string;
  label: string;
  /** Returns a cancel function. */
  run: (push: (chunk: string) => void, done: () => void) => () => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Deterministic PRNG (mulberry32). Scenario F's "random" token jitter is
 * seeded with a fixed constant so every run produces the IDENTICAL chunk
 * split and delay sequence — cross-run comparisons stay apples-to-apples
 * instead of adding a second layer of run-to-run noise. (Within a single
 * run both sides always saw the same stream regardless; seeding fixes the
 * BETWEEN-runs variance.)
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

/** Fixed seed for scenario F. Displayed in the UI so reruns are known-reproducible. */
export const RANDOM_TOKENS_SEED = 0xa11ce;

import { DEFAULT_PAYLOAD, withDefs } from '@ai-react-markdown/engine';
export { DEFAULT_PAYLOAD, withDefs };

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

/** Top-level markdown block count of a payload — same split the scenarios
 *  use. Surfaced in the comparison UI so readers can see the payload
 *  regime (tiny payloads make the block-memo delta noise-dominated). */
export const countBlocks = (payload: string): number => splitBlocks(payload).length;

export const buildScenarios = (payload: string): Record<string, ScenarioConfig> => {
  const fullPayload = payload || DEFAULT_PAYLOAD;
  const blocks = splitBlocks(fullPayload);
  return SCENARIO_FACTORIES_FROM(fullPayload, blocks);
};

const SCENARIO_FACTORIES_FROM = (fullPayload: string, blocks: string[]): Record<string, ScenarioConfig> => ({
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
    description:
      'Random chunk size 2–8 chars + random delay 15–60ms. Mimics real LLM token jitter. ' +
      `Seeded (0x${RANDOM_TOKENS_SEED.toString(16)}) — every run replays the identical chunk pattern.`,
    hypothesis: 'The most realistic profile — what a chat UI will actually face.',
    run: (push, done) => {
      const rand = mulberry32(RANDOM_TOKENS_SEED);
      const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
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
