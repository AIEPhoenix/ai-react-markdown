import type { Root as MdastRoot, RootContent as MdastNode } from 'mdast';
import type { Root as HastRoot } from 'hast';
import { visit } from 'unist-util-visit';
import { buildBlocks, type BuildBlocksOptions, type BuildBlocksResult, type RenderItem } from './blockPlan';

export type BlockPlanner = (
  mdast: MdastRoot,
  hast: HastRoot,
  source: string,
  options?: BuildBlocksOptions
) => BuildBlocksResult;

const UNPAIRED_TYPES = new Set(['html', 'definition', 'footnoteDefinition']);

/** Reuse the engine's retained prefix plans, including reference blocks.
 * Reference prefixes require full-document context when planning the tail.
 * Raw HTML and definition regions retain complete planning: their ownership
 * need not be one-to-one. Identity checks, not source-text
 * guesses, establish which trees the incremental engine actually retained.
 * Top-level traversal remains O(blocks); reference context still visits the
 * full mdast when needed, while per-block HAST planning is tail-only. */
export function createBlockPlanner(): BlockPlanner {
  let previous:
    | {
        mdast: MdastRoot;
        hast: HastRoot;
        source: string;
        result: BuildBlocksResult;
        phantoms: BuildBlocksOptions['phantomFootnoteLabels'];
      }
    | undefined;
  const eligible = new WeakMap<MdastNode, boolean>();
  const isEligible = (node: MdastNode) => {
    let result = eligible.get(node);
    if (result === undefined) {
      result = true;
      visit(node, (child) => {
        if (UNPAIRED_TYPES.has(child.type)) result = false;
      });
      eligible.set(node, result);
    }
    return result;
  };
  return (mdast: MdastRoot, hast: HastRoot, source: string, options: BuildBlocksOptions = {}): BuildBlocksResult => {
    let m = 0;
    let h = 0;
    let reusedContext = false;
    if (previous && source.startsWith(previous.source) && options.phantomFootnoteLabels === previous.phantoms) {
      const prevHast = previous.hast.children;
      const prevPlan = previous.result.plan;
      /** Identity-retained whitespace text between two block outputs. */
      const isRetainedGap = (i: number): boolean => {
        const gap = hast.children[i];
        return gap === prevHast[i] && gap.type === 'text' && !/\S/.test(gap.value);
      };
      while (m < mdast.children.length) {
        const node = mdast.children[m];
        const el = hast.children[h];
        const item = prevPlan[h];
        if (
          node !== previous.mdast.children[m] ||
          el !== prevHast[h] ||
          !el ||
          el.type !== 'element' ||
          !item ||
          item.kind !== 'block' ||
          item.info.startOffset !== node.position?.start.offset ||
          !isEligible(node)
        )
          break;
        // One mdast node can own several top-level hast siblings: an
        // image-only paragraph with two images on one line is unwrapped to
        // `img, " ", img`, and every sibling's block info carries the
        // paragraph's start offset. Consume all of them with the node —
        // leaving one behind put its offset inside the reused prefix range,
        // where the tail's mdast slice has no counterpart (the dev build
        // threw, production planned an uncached inline item and remounted
        // the image on every frame). A sibling that is not identity-retained
        // means the node's output was not carried over whole: give the node
        // back and stop the prefix here.
        const startOffset = item.info.startOffset;
        let next = h + 1;
        let complete = true;
        for (;;) {
          let probe = next;
          while (probe < hast.children.length && isRetainedGap(probe)) probe++;
          const sibling = prevPlan[probe];
          if (!sibling || sibling.kind !== 'block' || sibling.info.startOffset !== startOffset) break;
          if (hast.children[probe] !== prevHast[probe]) {
            complete = false;
            break;
          }
          next = probe + 1;
        }
        if (!complete) break;
        reusedContext ||= item.info.hasReference;
        m++;
        h = next;
        while (h < hast.children.length && isRetainedGap(h)) h++;
      }
      // The tail is planned against `mdast.children.slice(m)`, so every tail
      // block must start at or past the reused prefix's end. An output node
      // that still points inside the prefix (a sibling shape the loop above
      // does not model) cannot be attributed from the tail slice; plan the
      // whole document instead, so the dev-only "no mdast counterpart"
      // invariant keeps firing only for positions synthesized outside the
      // source.
      if (m > 0) {
        const prefixEnd = mdast.children[m - 1].position?.end.offset ?? 0;
        for (let i = h; i < hast.children.length; i++) {
          const child = hast.children[i];
          const at = child.type === 'element' ? child.position?.start.offset : undefined;
          if (at !== undefined && at < prefixEnd) {
            m = 0;
            h = 0;
            reusedContext = false;
            break;
          }
        }
      }
    }
    let result: BuildBlocksResult;
    if (m > 0 && previous) {
      const tail = buildBlocks(
        { ...mdast, children: mdast.children.slice(m) },
        { ...hast, children: hast.children.slice(h) },
        source,
        reusedContext ? { ...options, contextMdast: options.contextMdast ?? mdast } : options
      );
      const prefix = previous.result.plan.slice(0, h);
      const prefixBlocks = prefix.filter(
        (item): item is Extract<RenderItem, { kind: 'block' }> => item.kind === 'block'
      );
      result = {
        ...tail,
        plan: [
          ...prefix,
          ...tail.plan.map((item) =>
            /^inline-i\d+$/.test(item.key) ? { ...item, key: `inline-i${Number(item.key.slice(8)) + h}` } : item
          ),
        ],
        blocks: [...prefixBlocks.map((item) => item.info), ...tail.blocks],
        blockHasts: [...prefixBlocks.map((item) => item.el), ...tail.blockHasts],
      };
    } else result = buildBlocks(mdast, hast, source, options);
    previous = { mdast, hast, source, result, phantoms: options.phantomFootnoteLabels };
    return result;
  };
}
