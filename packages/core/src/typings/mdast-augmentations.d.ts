/**
 * Load the mdast module augmentations (math / GFM / definition-list node
 * types) into core's type graph. Before the engine split, these arrived as
 * a side effect of pluginChain.ts importing the remark plugins; pluginChain
 * now lives in the engine, but core source that stays behind (spliceParse
 * until M3, tailSignal's mdast walks permanently) still narrows on node
 * types like `'math'` that only exist via augmentation.
 *
 * Type-only imports — zero runtime bytes; the packages remain declared in
 * core's dependencies.
 */

import type {} from 'remark-math';
import type {} from 'remark-gfm';
