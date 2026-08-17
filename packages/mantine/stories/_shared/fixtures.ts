/**
 * Fixtures for the Mantine branch. Everything here exists to exercise a
 * renderer the Mantine package substitutes — highlighted code blocks, the
 * collapse control, the JSON pretty-printer, mermaid diagrams. Core's fixture
 * library covers markdown features that both packages render identically;
 * duplicating those here would only invite the two copies to drift.
 *
 * No fixture may reference a network resource. The static export is served
 * from disk and must make zero external requests.
 */

/**
 * A fence long enough to be worth collapsing. Mantine's collapsed state caps
 * the block at `maxCollapsedHeight` (320px as the wrapper configures it), so
 * the sample has to comfortably exceed that — roughly 40 lines at the default
 * font size.
 */
export const LONG_CODE_DOC: string = [
  '# A long code block',
  '',
  'The fence below runs past the collapsed height cap, so the expand control',
  'has something to do.',
  '',
  '```typescript',
  "import { useCallback, useEffect, useRef, useState } from 'react';",
  '',
  'export interface StreamOptions {',
  '  /** Characters emitted per tick. */',
  '  chunkSize: number;',
  '  /** Milliseconds between ticks. */',
  '  interval: number;',
  '}',
  '',
  'const DEFAULTS: StreamOptions = { chunkSize: 4, interval: 24 };',
  '',
  '/** Replay a finished response as if it were still arriving. */',
  'export function useReplay(source: string, options?: Partial<StreamOptions>) {',
  '  const { chunkSize, interval } = { ...DEFAULTS, ...options };',
  "  const [content, setContent] = useState('');",
  '  const [streaming, setStreaming] = useState(false);',
  '  const cursor = useRef(0);',
  '',
  '  const restart = useCallback(() => {',
  '    cursor.current = 0;',
  "    setContent('');",
  '    setStreaming(true);',
  '  }, []);',
  '',
  '  useEffect(() => {',
  '    if (!streaming) return;',
  '    const timer = window.setInterval(() => {',
  '      cursor.current += chunkSize;',
  '      setContent(source.slice(0, cursor.current));',
  '      if (cursor.current >= source.length) {',
  '        window.clearInterval(timer);',
  '        setStreaming(false);',
  '      }',
  '    }, interval);',
  '    return () => window.clearInterval(timer);',
  '  }, [streaming, source, chunkSize, interval]);',
  '',
  '  useEffect(restart, [restart]);',
  '',
  '  return { content, streaming, restart };',
  '}',
  '```',
].join('\n');

/**
 * Minified JSON, including a field whose value is itself a JSON document
 * encoded as a string. The Mantine code block runs `deep-parse-json` before
 * printing, so both levels come out formatted — the nested one stops being an
 * unreadable escaped blob.
 */
export const JSON_PAYLOAD_DOC: string = [
  '# A minified JSON payload',
  '',
  'One line as written, two levels deep once printed:',
  '',
  '```json',
  '{"model":"claude","stream":true,"usage":{"input_tokens":1841,"output_tokens":612},' +
    '"tool_result":"{\\"query\\":\\"weather in Kyoto\\",\\"hits\\":[{\\"title\\":\\"Kyoto forecast\\",' +
    '\\"score\\":0.92},{\\"title\\":\\"Kansai outlook\\",\\"score\\":0.71}]}"}',
  '```',
].join('\n');

/**
 * A fence with no info string at all. Which branch of the code-block renderer
 * this lands in depends entirely on `autoDetectUnknownLanguage`, which is what
 * the comparison story is built to show.
 */
export const UNLABELED_CODE_DOC: string = [
  '# A fence with no language',
  '',
  '```',
  'def summarize(chunks: list[str]) -> str:',
  '    """Join streamed chunks and trim the trailing partial word."""',
  "    text = ''.join(chunks)",
  "    head, _, tail = text.rpartition(' ')",
  '    return head if tail.endswith(("…", "...")) else text',
  '```',
].join('\n');

/**
 * Short, but every element in it is one whose colour comes from a token that
 * the color scheme swaps: prose text, a link, a highlighted code block, table
 * borders, a blockquote rule, inline code. Anything longer would push the two
 * comparison panels below the fold.
 */
export const SCHEME_SAMPLE_DOC: string = [
  '## Retrieval results',
  '',
  'Three sources matched the query, ranked by [relevance](https://example.test/ranking).',
  'The top hit was cached, so `retrieve()` returned in under 40 ms.',
  '',
  '| Source | Score |',
  '| ------ | ----: |',
  '| Kyoto forecast | 0.92 |',
  '| Kansai outlook | 0.71 |',
  '',
  '```typescript',
  'const hits = await retrieve(query, { limit: 3 });',
  'return hits.filter((hit) => hit.score > 0.5);',
  '```',
  '',
  '> Cached hits skip the network entirely.',
].join('\n');

/**
 * Two diagrams that render as static SVG. The flowchart and the sequence
 * diagram take different code paths inside mermaid and report different chart
 * types in the header tag, so both are worth having on screen at once.
 */
export const MERMAID_STATIC_DOC: string = [
  '# Two diagrams',
  '',
  'A flowchart:',
  '',
  '```mermaid',
  'flowchart LR',
  '    A[Prompt] --> B{Needs a tool?}',
  '    B -- yes --> C[Call tool]',
  '    B -- no --> D[Answer directly]',
  '    C --> E[Merge results]',
  '    D --> E',
  '    E --> F[Stream reply]',
  '```',
  '',
  'And a sequence diagram:',
  '',
  '```mermaid',
  'sequenceDiagram',
  '    participant U as User',
  '    participant A as Assistant',
  '    participant T as Tool',
  '    U->>A: Ask a question',
  '    A->>T: Look it up',
  '    T-->>A: Results',
  '    A-->>U: Streamed answer',
  '```',
].join('\n');

/**
 * The Mantine front door: one plausible assistant response that touches every
 * renderer this package substitutes, plus enough ordinary markdown to keep it
 * readable as prose rather than as a feature checklist.
 *
 * Deliberately not core's `KITCHEN_SINK`. Both are showcase documents, but
 * they are aimed at different renderers: core's covers what the base package
 * draws, while this one leans on what Mantine substitutes — highlighted
 * fences in several languages, a minified JSON payload, and mermaid.
 */
export const MANTINE_SHOWCASE: string = [
  '# Streaming a tool-using answer',
  '',
  'Here is how a retrieval-augmented reply gets assembled, end to end.',
  '',
  '## The control flow',
  '',
  '```mermaid',
  'flowchart TD',
  '    Q[User question] --> P[Plan]',
  '    P --> R[Retrieve]',
  '    R --> G[Generate]',
  '    G --> V{Grounded?}',
  '    V -- yes --> S[Stream to client]',
  '    V -- no --> R',
  '```',
  '',
  '## Calling the API',
  '',
  'The request body, minified the way a network log shows it:',
  '',
  '```json',
  '{"model":"claude","stream":true,"max_tokens":1024,"messages":[{"role":"user",' +
    '"content":"summarize the retrieval results"}],"metadata":{"session":"a1b2c3","retries":0}}',
  '```',
  '',
  'Reading the stream in TypeScript:',
  '',
  '```typescript',
  'const stream = await client.messages.stream({ model, messages, max_tokens: 1024 });',
  '',
  "let text = '';",
  'for await (const event of stream) {',
  "  if (event.type === 'content_block_delta') {",
  '    text += event.delta.text;',
  '    render(text, /* streaming */ true);',
  '  }',
  '}',
  'render(text, /* streaming */ false);',
  '```',
  '',
  'The same loop on the server, in Python:',
  '',
  '```python',
  'async def relay(client, messages):',
  '    async with client.messages.stream(model=MODEL, messages=messages) as stream:',
  '        async for text in stream.text_stream:',
  '            yield text',
  '```',
  '',
  'And the shell command that starts it:',
  '',
  '```bash',
  'curl -N https://api.example.test/v1/messages \\',
  "  -H 'content-type: application/json' \\",
  '  -d @request.json',
  '```',
  '',
  '## Cost model',
  '',
  'Latency is dominated by the retrieval hop, not by generation[^bench].',
  '',
  '| Stage | Median | p95 | Share of total |',
  '| ----- | -----: | --: | -------------: |',
  '| Plan | 40 ms | 90 ms | 6% |',
  '| Retrieve | 310 ms | 880 ms | 47% |',
  '| Generate (first token) | 180 ms | 420 ms | 27% |',
  '| Render | 130 ms | 260 ms | 20% |',
  '',
  'Expected wait for $n$ retrieval hops, given per-hop latency $\\ell$:',
  '',
  '$$',
  'T(n) = t_{\\text{plan}} + n\\,\\ell + t_{\\text{ttft}}',
  '$$',
  '',
  '## What the wrapper is doing',
  '',
  'Every fence above is drawn by the Mantine code block rather than by the base',
  'renderer: the language comes off the info string, **a block past the height cap',
  'collapses** behind an expand control, and the minified JSON is pretty-printed on',
  'the way in. Inline spans such as `retrieve()` stay with the surrounding',
  "typography, which is core's work rather than the wrapper's.",
  '',
  '> Streaming is not a rendering optimization. It is the product.',
  '',
  '[^bench]: Measured on the Performance Lab harnesses in this Storybook, not on production traffic.',
].join('\n');
