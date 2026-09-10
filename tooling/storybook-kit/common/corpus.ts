import markdown from '../../../corpus/documents/markdown.md?raw';
import code from '../../../corpus/documents/code.md?raw';
import math from '../../../corpus/documents/math.md?raw';
import mermaid from '../../../corpus/documents/mermaid.md?raw';

/** Exact document excerpts. Fail visibly when a corpus heading changes. */
export function excerpt(document: string, start: string, end?: string): string {
  const from = document.indexOf(`\n${start}\n`);
  const to = end ? document.indexOf(`\n${end}\n`, from + start.length + 2) : document.length;
  if (from < 0 || to < 0 || to <= from) throw new Error(`Missing corpus excerpt: ${start} → ${end}`);
  return document.slice(from + 1, to).trim();
}

// These selections contain no remote images. Full raw corpus files also include
// network/image hazards: do not feed those into general-purpose examples.
export const TABLES = excerpt(markdown, '### gfm-table-alignment', '### gfm-table-inline-content');
export const TASKS = excerpt(markdown, '### gfm-task-list', '### gfm-strikethrough');
export const EMPHASIS = excerpt(markdown, '### inline-emphasis', '### inline-mark');
export const LINKS = excerpt(markdown, '### link-forms', '### link-hash-and-escapes');
export const QUOTES = excerpt(markdown, '### block-quotes', '### block-thematic-breaks');
export const CODE = excerpt(code, '### lang-typescript', '### lang-rust');
export const MATH = excerpt(math, '### authored-inline-density', '### authored-cases');
export const DIAGRAMS = excerpt(mermaid, '### flowchart-basic', '### flowchart-shapes');
export const SHOWCASE = [EMPHASIS, TABLES, TASKS, QUOTES, CODE, MATH].join('\n\n');
export const CORPUS_SOURCES = {
  markdown: 'corpus/documents/markdown.md',
  code: 'corpus/documents/code.md',
  math: 'corpus/documents/math.md',
  mermaid: 'corpus/documents/mermaid.md',
} as const;

/** Compact shared input for repeated performance/replay runs. */
export const STREAMING_SAMPLE = [
  EMPHASIS,
  TABLES,
  excerpt(code, '### lang-typescript', '### lang-tsx'),
  excerpt(math, '### authored-inline-density', '### authored-nested-fractions'),
].join('\n\n');
