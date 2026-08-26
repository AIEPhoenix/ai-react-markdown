/**
 * TEST/STORY helper (exported from the package barrel for the Storybook
 * streams): prefix
 * snapshots sliced at CODE-POINT granularity, so a frame boundary never
 * splits a surrogate pair. Every streaming verifier in the repo — the
 * splice-equivalence arbiter, the prefixFreeze experiment harness, and the
 * Storybook smoke/playground streams — derives its frame sequence from
 * this one implementation; a change here (e.g. moving to grapheme
 * clusters) changes them all together instead of leaving four copies to
 * drift (review finding R4).
 */
export function codePointSnapshots(payload: string, chunkSize: number): string[] {
  const codePoints = Array.from(payload);
  const snapshots: string[] = [];
  for (let i = chunkSize; i < codePoints.length; i += chunkSize) {
    snapshots.push(codePoints.slice(0, i).join(''));
  }
  snapshots.push(payload);
  return snapshots;
}
