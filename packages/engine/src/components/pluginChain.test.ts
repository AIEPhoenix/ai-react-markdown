/**
 * Pins the order-independence contract of the produced chain: the canonical
 * per-stage tables — not the caller's array order — fix each plugin's splice
 * position (see `buildCoreRemarkPlugins`). The property currently holds by
 * construction; this test keeps it holding through future refactors.
 */
import { describe, expect, test } from 'vitest';
import rehypeRaw from '@ai-markdown/rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkPangu from 'remark-pangu';
import remarkSmartypants from 'remark-smartypants';
import type { Root as HastRoot, RootContent as HastContent } from 'hast';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins } from './pluginChain';
import { parseStage, transformStage } from './markdown';
import { rehypeVerifyEngineTags } from './rehypeVerifyEngineTags';
import { sanitizeSchema } from './sanitizeSchema';
import type { CrossChunkHandlerOptions } from './customMdastHandlers';
import { defaultEnginePlugins, highlight, pangu, smartypants } from '../plugins/catalog';
import type { AIMarkdownEnginePlugin } from '../plugins/defs';

/** Unwrap `[plugin, options]` tuples to the plugin function for identity comparison. */
function chainShape(chain: ReturnType<typeof buildCoreRemarkPlugins>) {
  return chain.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
}

describe('buildCoreRemarkPlugins — user array order independence', () => {
  test('reversed full selection produces the identical chain', () => {
    const forward = buildCoreRemarkPlugins(defaultEnginePlugins);
    const reversed = buildCoreRemarkPlugins([...defaultEnginePlugins].reverse());
    expect(chainShape(reversed)).toEqual(chainShape(forward));
  });

  test('partial selections agree regardless of order', () => {
    const a = buildCoreRemarkPlugins([highlight, pangu, smartypants]);
    const b = buildCoreRemarkPlugins([smartypants, highlight, pangu]);
    const c = buildCoreRemarkPlugins([pangu, smartypants, highlight]);
    expect(chainShape(b)).toEqual(chainShape(a));
    expect(chainShape(c)).toEqual(chainShape(a));
  });
});

function textOf(node: HastRoot | HastContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' || node.type === 'root') return node.children.map(textOf).join('');
  return '';
}

function renderText(markdown: string, enginePlugins: readonly AIMarkdownEnginePlugin[]): string {
  return textOf(
    transformStage(
      parseStage({
        children: markdown,
        remarkPlugins: buildCoreRemarkPlugins(enginePlugins),
        rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, ''),
        remarkRehypeOptions: { allowDangerousHtml: true, clobberPrefix: '' },
      })
    )
  ).trim();
}

describe('buildCoreRemarkPlugins — pangu runs before SmartyPants', () => {
  // SmartyPants decides whether a straight quote opens or closes by the
  // character before it. Run first, it sees `文"引` — no space before the
  // quote — and calls both quotes closers; pangu then pads the CJK/Latin
  // boundaries around the curly quotes, which lands as `中文” 引号” 中文`.
  // With pangu first the quotes sit between spaces SmartyPants can read.

  test('CJK prose quoting a word gets one opening and one closing quote', () => {
    const out = renderText('中文"引号"中文', [pangu, smartypants]);
    expect(out).not.toContain('”引号”');
    expect(out).not.toContain('” 引号”');
    // pangu pads the quotes on both sides; that spacing is its own rule.
    expect(out).toBe('中文 “引号” 中文');
  });

  test('Latin prose is unchanged by the order', () => {
    const md = 'He said "hello" -- and "quoted" text...';
    expect(renderText(md, [pangu, smartypants])).toBe('He said “hello” — and “quoted” text…');
    expect(renderText(md, [smartypants])).toBe('He said “hello” — and “quoted” text…');
  });

  test('the canonical chain places pangu before smartypants whatever the caller order', () => {
    for (const selection of [
      [smartypants, pangu],
      [pangu, smartypants],
    ]) {
      const shape = chainShape(buildCoreRemarkPlugins(selection));
      const iPangu = shape.indexOf(remarkPangu as never);
      const iSmarty = shape.indexOf(remarkSmartypants as never);
      expect(iPangu).toBeGreaterThan(-1);
      expect(iSmarty).toBeGreaterThan(-1);
      expect(iPangu).toBeLessThan(iSmarty);
    }
  });
});

describe('buildCoreRehypePlugins — provenance verifier placement and compatibility', () => {
  test("the two-argument call shape still compiles and installs no verifier (today's chain)", () => {
    const chain = buildCoreRehypePlugins(sanitizeSchema, '');
    const names = chain.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    expect(names).not.toContain(rehypeVerifyEngineTags);
    expect(names.indexOf(rehypeRaw as never)).toBe(0);
    expect(names.indexOf(rehypeSanitize as never)).toBe(1);
  });

  test('with a credential the verifier sits after rehypeRaw and before rehypeSanitize', () => {
    const chain = buildCoreRehypePlugins(sanitizeSchema, '', { provenance: 'p' });
    const names = chain.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    const raw = names.indexOf(rehypeRaw as never);
    const verify = names.indexOf(rehypeVerifyEngineTags as never);
    const sanitize = names.indexOf(rehypeSanitize as never);
    expect(raw).toBe(0);
    expect(verify).toBe(1);
    expect(sanitize).toBe(2);
    const entry = chain[verify] as unknown as [unknown, { provenance: string }];
    expect(entry[1]).toEqual({ provenance: 'p' });
  });

  test('CrossChunkHandlerOptions without provenance is still a complete option object (type pin)', () => {
    const opts: CrossChunkHandlerOptions = {
      phantomFootnoteLabels: new Set(),
      phantomLinkLabels: new Set(),
      preserveOrphan: true,
      documentId: 'd',
    };
    expect(opts.provenance).toBeUndefined();
  });
});
