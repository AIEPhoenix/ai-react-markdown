/** Streaming equivalent of /\r?\n[ \t]*\r?\n/g. Keep the unmatched
 * newline/CR seam so appends scan only new characters. Passing from=0
 * starts a new lineage. Matches are non-overlapping, like the regex. */
export function createBlankLineScanner(): (source: string, from?: number) => number {
  let end = 0;
  let newline = false;
  let cr = false;
  return (source, from = 0) => {
    if (from === 0) {
      end = 0;
      newline = false;
      cr = false;
    }
    for (let i = from; i < source.length; i++) {
      const c = source[i];
      if (c === '\n') {
        if (newline) {
          end = i + 1;
          newline = false;
        } else newline = true;
        cr = false;
      } else if (newline) {
        if ((c === ' ' || c === '\t') && !cr) continue;
        if (c === '\r' && !cr) cr = true;
        else {
          newline = false;
          cr = false;
        }
      }
    }
    return end;
  };
}
