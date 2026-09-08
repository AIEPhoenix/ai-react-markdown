/**
 * Shared cross-chunk streaming fixtures (final-review R4): the chunk layout
 * and the stream-cursor slicing are the ground truth BOTH coordinated
 * surfaces (the CrossChunkIncrementalComparison story and the
 * CrossChunkStreamingSmoke play test) must agree on — a drifted copy would
 * let a chunk-filling regression surface in only one of them. Lives in a
 * fixtures module (not the comparison component) so the smoke's module
 * graph doesn't drag in the profiler/run-history scaffolding.
 */

export const CHUNK_COUNT = 3;

/** Cross-chunk decoration appended per chunk slice: chunk 1 DEFINES labels,
 *  chunks 2/3 REFERENCE them — guaranteeing phantom injection + aggregate
 *  footer regardless of the user payload. */
export const CHUNK_DECORATIONS = [
  '\n\nChunk one defines a footnote[^xck1] locally.\n\n[^xck1]: defined in chunk one\n\n[xck-spec]: https://example.com/spec\n',
  '\n\nChunk two cross-references[^xck1] and links [the spec][xck-spec].\n',
  '\n\nChunk three closes with another cross reference[^xck1].\n',
] as const;

/** Split at the nearest block boundary to each third, then decorate. */
export function buildChunkSources(payload: string): string[] {
  const cuts: number[] = [0];
  for (let i = 1; i < CHUNK_COUNT; i++) {
    const target = Math.floor((payload.length * i) / CHUNK_COUNT);
    const at = payload.indexOf('\n\n', target);
    cuts.push(at === -1 ? payload.length : at + 2);
  }
  cuts.push(payload.length);
  return Array.from({ length: CHUNK_COUNT }, (_, i) => payload.slice(cuts[i], cuts[i + 1]) + CHUNK_DECORATIONS[i]);
}

/** Fill chunks sequentially from the global stream cursor. Together with
 *  streaming `chunkSources.join('')`, this conserves length: the streamed
 *  document covers every chunk source byte exactly once. */
export function sliceChunkContents(chunkSources: readonly string[], streamedLength: number): string[] {
  const out: string[] = [];
  let cursor = streamedLength;
  for (const source of chunkSources) {
    const take = Math.max(0, Math.min(cursor, source.length));
    cursor -= take;
    out.push(source.slice(0, take));
  }
  return out;
}
