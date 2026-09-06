import type { Element, Root } from 'hast';
import rehypeSanitize from 'rehype-sanitize';
import { normalizeUri } from 'micromark-util-sanitize-uri';
import type { SanitizeSchema } from './extendSanitizeSchema';
import type { UrlTransform } from './markdown';
import { buildTransform } from './markdown/transform';
import { rebaseHashHref } from './rehypeRebaseHashLinks';

/** Resolve the final element, not just its URL: placeholders reach React
 * after the normal rehype passes, so their a/img must apply those passes too.
 * The marker represents already-rendered link children and distinguishes
 * sanitizer unwrapping from stripping the element with its contents. */
export function resolveCrossChunkReference(
  input: {
    tagName: 'a' | 'img';
    url: string;
    title?: string;
    alt?: string;
    node?: Pick<Element, 'children' | 'position' | 'data'>;
  },
  schema: SanitizeSchema,
  urlTransform: UrlTransform,
  clobberPrefix: string
): { element: Element | null; keepChildren: boolean } {
  const key = input.tagName === 'a' ? 'href' : 'src';
  const element: Element = {
    type: 'element',
    tagName: input.tagName,
    properties: {
      [key]: normalizeUri(input.url),
      ...(input.tagName === 'img' ? { alt: input.alt ?? '' } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
    },
    children: input.tagName === 'a' ? [{ type: 'text', value: '__reference_children__' }] : [],
  };
  // The standalone sanitizer checks the pre-sanitize ancestor stack. That
  // context is no longer around this element at React time. The provenance
  // verifier records it in HAST data when needed; authored HTML attributes
  // cannot populate this channel. Once the requirement is satisfied, omit
  // only this final tag's ancestor rule for the isolated sanitize call.
  const requiredAncestors = schema.ancestors?.[input.tagName];
  const recordedAncestors = (input.node?.data as { referenceAncestors?: unknown } | undefined)?.referenceAncestors;
  let finalSchema = schema;
  if (
    requiredAncestors &&
    Array.isArray(recordedAncestors) &&
    requiredAncestors.some((tag) => recordedAncestors.includes(tag))
  ) {
    const ancestors = { ...schema.ancestors };
    delete ancestors[input.tagName];
    finalSchema = { ...schema, ancestors };
  }
  const root: Root = rehypeSanitize({ ...finalSchema, clobberPrefix })({ type: 'root', children: [element] });
  const node = root.children[0];
  if (node?.type !== 'element') return { element: null, keepChildren: node?.type === 'text' };
  if (node.tagName === 'a' && typeof node.properties.href === 'string') {
    node.properties.href = rebaseHashHref(node.properties.href, clobberPrefix);
  }
  // urlTransform sees sanitized properties and the rebased hash, in the
  // same order as the standalone pipeline. Removed attributes stay absent.
  node.children = input.node?.children ?? [];
  if (input.node?.position) node.position = input.node.position;
  buildTransform({
    allowedElements: undefined,
    disallowedElements: undefined,
    allowElement: undefined,
    skipHtml: undefined,
    unwrapDisallowed: undefined,
    urlTransform,
  })(node, 0, root);
  node.children = [];
  return { element: node, keepChildren: false };
}
