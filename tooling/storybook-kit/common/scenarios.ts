/** Cross-chunk reference syntax is purpose-built: complete corpus documents do
 * not model a definition arriving in a separately mounted document chunk. */
export const REFERENCE_SCENARIO = {
  id: 'cross-chunk-definition-lifecycle',
  reader: 'A claim[^source] and [the source][site].',
  definition: '[^source]: Shared citation\n\n[site]: https://example.test/original',
  updated: '[^source]: Revised citation\n\n[site]: https://example.test/revised',
} as const;
