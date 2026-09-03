/**
 * Code, math and mermaid INSIDE markdown constructs — the combinations, not
 * the constructs.
 *
 * WHY THIS IS A MARKDOWN GROUP AND NOT ITS OWN DOCUMENT. It was one, briefly,
 * on the reasoning that it "spans domains". It does not: a mermaid diagram is
 * a fenced code block, a display formula is a leaf block, and both are things
 * markdown contains. The domain split is about DEPTH — 1139 identifiers, 31
 * diagram types, 29 languages — and depth is what the other documents are
 * for. Combination is a property of the markdown document.
 *
 * WHY IT EXISTS AT ALL. The other four layers are each deep in one domain and
 * shallow across domains: `math.md` has 1139 identifiers and no table,
 * `code.md` has 29 languages and no footnote, `mermaid.md` has 31 diagram
 * types and no list. A node-type census over all of them reports full
 * coverage, and that census is exactly what cannot see the gap — the missing
 * thing is not a node type, it is a PAIR of them, and the denominator for
 * pairs is a product rather than a list.
 *
 * Measured 2026-09-03 before this file existed: `inlineMath` appeared in no
 * table cell, no list item, no footnote definition and no blockquote anywhere
 * in the corpus, while `markdown.md`'s own table case claimed to cover "every
 * inline construct inside table cells".
 *
 * WHY THESE COMBINATIONS AND NOT OTHERS. Each one puts a construct that owns
 * a PARSER inside a construct that owns a CONTAINER:
 *
 *   in a table cell   the pipe is the cell delimiter, and code spans, math and
 *                     links all have their own opinions about it
 *   in a list item    indentation decides whether a fence is a fence or
 *                     indented code, and how far a display block extends
 *   in a footnote     the definition's continuation rules meet a block that
 *                     spans lines
 *   in a blockquote   every line carries a `>` that the inner parser must not
 *                     see, including inside a fence
 *
 * Those four are where a streaming renderer's incremental path actually
 * breaks, because each is a place where a container's boundary and a leaf's
 * boundary are decided by different code.
 *
 * Everything here closes. The corpus has terminal documents for the
 * unclosed shapes and they live in their own files, for the reason
 * `documents.ts` explains.
 */

import type { MarkdownCase } from './constructs.ts';

export const MARKDOWN_MIXED: readonly MarkdownCase[] = [
  {
    id: 'mixed-answer-shape',
    probes: 'the whole shape of one answer — prose, inline math, inline code, a fence, a display block and a diagram',
    src: `The freeze boundary is the offset before which rendered output cannot
change. Everything before it is reused; everything after it is reparsed on
every chunk, which is why the cost of one update is \`O(tail)\` rather than
\`O(document)\` — as long as the boundary keeps moving.

For a document of $n$ characters arriving in $k$ chunks, the naive cost is

$$
C_{\\text{naive}} = \\sum_{i=1}^{k} O(n_i) = O(nk)
$$

while the incremental path pays only for the unfrozen tail:

$$
C_{\\text{incremental}} = \\sum_{i=1}^{k} O(n_i - b_i)
$$

where $b_i$ is the boundary after chunk $i$. The scanner that computes it:

\`\`\`ts
export function computeFreezeBoundary(text: string, options: ScanOptions): ScanResult {
  const lines = splitLines(text);
  let boundary = 0;
  for (const line of lines) {
    if (isHazardous(line, options)) break;
    boundary = line.end;
  }
  return { boundary, checkpoint: null };
}
\`\`\`

And the path a chunk takes through it:

\`\`\`mermaid
flowchart LR
  A[chunk arrives] --> B[scan for the boundary]
  B --> C{boundary moved?}
  C -->|yes| D[splice: reuse the frozen prefix]
  C -->|no| E[fall back: full reparse]
  D --> F[commit]
  E --> F
\`\`\`

The fallback is not a failure — it is the correct answer, arrived at the
expensive way.`,
  },
  {
    id: 'mixed-in-table-cells',
    probes: 'code spans, math and links inside table cells, where the pipe belongs to the table',
    src: `| Path | Cost | Formula | Notes |
| --- | ---: | --- | --- |
| Full reparse | $O(nk)$ | $\\sum_{i=1}^{k} n_i$ | the baseline |
| Incremental | $O(n)$ amortised | $\\sum_{i=1}^{k} (n_i - b_i)$ | when the boundary moves |
| Frozen prefix | $O(1)$ | $b_i$ | reused verbatim |
| Call | — | \`computeFreezeBoundary(text, opts)\` | see [the scanner](#scanner) |
| Escaped pipe | — | $a \\vert b$ | a pipe the table must not eat |
| 中文一列 | 二十毫秒 | $\\alpha + \\beta$ | 混排单元格 |`,
  },
  {
    id: 'mixed-in-list-items',
    probes: 'fences and display math inside list items, where indentation decides what a block even is',
    src: `Three things happen per chunk:

1.  **Scan.** Walk the new lines and find the first hazardous one.

    \`\`\`ts
    const { boundary } = computeFreezeBoundary(text, { defListEnabled });
    \`\`\`

2.  **Compare.** The boundary must be monotone within a lineage:

    $$
    b_{i+1} \\geq b_i \\quad \\text{for every append}
    $$

    If it is not, the splice is abandoned and the frame falls back.

3.  **Splice.** Reuse the prefix, reparse the tail:

    - the prefix costs $O(1)$
    - the tail costs $O(n_i - b_i)$
    - the join is where every bug in this engine has lived

        indented code nested inside a list item, four spaces past the marker

4.  **Commit.** One React update.`,
  },
  {
    id: 'mixed-in-footnotes',
    probes: 'code and math inside footnote definitions, whose continuation rules span lines',
    src: `The scanner is approximate in the safe direction[^approx], and the
boundary is monotone only within one lineage[^lineage].

[^approx]: It over-blocks rather than under-blocks. An over-block costs
    freeze rate; an under-block is a correctness bug, because the frozen
    prefix would then change under an append:

    $$
    \\text{raw}(p + t) = \\text{raw}(p) + \\text{raw}(t)
    $$

    That identity is the whole contract.

[^lineage]: A non-append resets it. In code:

    \`\`\`ts
    if (!source.startsWith(prevSource)) {
      frozenSrcEnd = 0;
      frozenOut = '';
    }
    \`\`\`

    A regenerated answer is a new lineage, not a shorter one.`,
  },
  {
    id: 'mixed-in-blockquote',
    probes:
      'a fence and a diagram inside a blockquote, where every inner line carries a marker the inner parser must not see',
    src: `> **From the design review.**
>
> The two entry points must agree byte for byte:
>
> $$
> \\text{preprocess}(s) = \\text{incremental}(s) \\quad \\forall s
> $$
>
> which is checked like this:
>
> \`\`\`ts
> expect(incremental(acc)).toBe(preprocessLaTeX(acc));
> \`\`\`
>
> and the shape it is checking:
>
> \`\`\`mermaid
> flowchart TD
>   S[stateless entry] --> C{same bytes?}
>   I[incremental entry] --> C
>   C -->|yes| OK[contract holds]
>   C -->|no| BUG[divergence]
> \`\`\`
>
> — the reviewer, who was right`,
  },
  {
    id: 'mixed-cjk-answer',
    probes: 'the realistic CJK answer: Chinese prose carrying code, math and a diagram',
    src: `冻结边界指的是「这个偏移之前的输出不会再变」。边界之前直接复用，边界之后每来一个分片都要重新解析——所以一次更新的成本是 \`O(尾部)\` 而不是 \`O(全文)\`。

设文档有 $n$ 个字符、分 $k$ 个分片到达，朴素做法的总成本是

$$
C_{\\text{朴素}} = \\sum_{i=1}^{k} O(n_i) = O(nk)
$$

增量路径只为未冻结的尾部付费：

\`\`\`ts
const { boundary } = computeFreezeBoundary(text, { defListEnabled });
if (boundary > previousBoundary) {
  return spliceParse(frozenPrefix, text.slice(boundary));
}
\`\`\`

| 路径 | 成本 | 何时发生 |
| --- | --- | --- |
| 全量重解析 | $O(nk)$ | 边界不前移 |
| 增量拼接 | $O(n)$ 摊还 | 边界前移 |

\`\`\`mermaid
flowchart LR
  A[分片到达] --> B[扫描边界]
  B --> C{边界前移了吗}
  C -->|是| D[拼接：复用冻结前缀]
  C -->|否| E[兜底：全量重解析]
  D --> F[提交一次更新]
  E --> F
\`\`\`

兜底不是失败，它是用贵的方式得到的正确答案。`,
  },
];
