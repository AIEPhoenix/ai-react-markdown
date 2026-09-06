import type { Root as MdastRoot, RootContent as MdastNode } from 'mdast';
import type { Root as HastRoot } from 'hast';
import { visit } from 'unist-util-visit';
import { buildBlocks, type BuildBlocksOptions, type BuildBlocksResult, type RenderItem } from './blockMemo';

const CONTEXT_TYPES = new Set([
  'html',
  'definition',
  'footnoteDefinition',
  'footnoteReference',
  'linkReference',
  'imageReference',
]);

/** Reuse the engine's retained, context-free prefix plans. Reference-bearing
 * and raw HTML regions still use the complete planner: their ownership and
 * numbering can depend on later nodes. Identity checks, not source-text
 * guesses, establish which trees the incremental engine actually retained.
 * Top-level array traversal remains O(blocks); deep planning is tail-only. */
export function createBlockPlanner() {
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
        if (CONTEXT_TYPES.has(child.type)) result = false;
      });
      eligible.set(node, result);
    }
    return result;
  };
  return (mdast: MdastRoot, hast: HastRoot, source: string, options: BuildBlocksOptions = {}): BuildBlocksResult => {
    let m = 0;
    let h = 0;
    if (previous && source.startsWith(previous.source) && options.phantomFootnoteLabels === previous.phantoms) {
      while (m < mdast.children.length) {
        const node = mdast.children[m];
        const el = hast.children[h];
        const item = previous.result.plan[h];
        if (
          node !== previous.mdast.children[m] ||
          el !== previous.hast.children[h] ||
          !el ||
          el.type !== 'element' ||
          !item ||
          item.kind !== 'block' ||
          item.info.hasReference ||
          item.info.startOffset !== node.position?.start.offset ||
          !isEligible(node)
        )
          break;
        m++;
        h++;
        while (h < hast.children.length) {
          const gap = hast.children[h];
          if (gap !== previous.hast.children[h] || gap.type !== 'text' || /\S/.test(gap.value)) break;
          h++;
        }
      }
    }
    let result: BuildBlocksResult;
    if (m > 0 && previous) {
      const tail = buildBlocks(
        { ...mdast, children: mdast.children.slice(m) },
        { ...hast, children: hast.children.slice(h) },
        source,
        options
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
            /^inline-i\d+$/.test(item.reactKey)
              ? { ...item, reactKey: `inline-i${Number(item.reactKey.slice(8)) + h}` }
              : item
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
