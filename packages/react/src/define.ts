/**
 * `define*` factories — the packaging unit for integration-time
 * configuration (EXECUTION-PLAN §3.3).
 *
 * Factory output is a frozen, fully typed, reference-stable flat prop
 * fragment, spread into `<AIMarkdown>`:
 *
 * ```tsx
 * const THEME = defineTheme({ fontSize: 15, variant: 'default' });
 * const BEHAVIORS = defineBehaviors({ blockMemo: false });
 * const PIPELINE = definePipeline({ contentPreprocessors: [...], sanitizeSchema: mySchema });
 *
 * // runtime-varying fields go AFTER the spreads; later props win
 * <AIMarkdown content={content} {...THEME} {...BEHAVIORS} {...PIPELINE} colorScheme={userScheme} />
 * ```
 *
 * Three disciplines (binding):
 *
 * 1. A factory is identity + types + `Object.freeze`, zero logic. No
 *    default-filling (defaults live only in the component's destructuring),
 *    no merging, no side effects. `define` (vs `create`) signals "declares
 *    data", not "manufactures a live object".
 * 2. Factories package values decided at integration time. Data, State, and
 *    Document members change per frame/message and get no factory;
 *    runtime-switchable fields may enter a factory as initial values, with
 *    runtime overrides as post-spread props (see `colorScheme` above).
 * 3. Factories are sugar, not gates — passing bare flat props is always legal.
 *
 * Core factories accept core prop types only. Wrappers re-export widened
 * factories for their extension fields (e.g. `defineMantineBehaviors`) —
 * still identity + own types + freeze.
 *
 * @module define
 */

import type { AIMarkdownProps } from './index';

/** Theme-system props packagable at integration time. */
export type AIMarkdownThemeProps = Pick<
  AIMarkdownProps,
  'fontSize' | 'variant' | 'colorScheme' | 'Typography' | 'ExtraStyles'
>;

/** Behavior-system core switches. */
export type AIMarkdownBehaviorProps = Pick<
  AIMarkdownProps,
  'blockMemo' | 'incrementalParse' | 'preserveOrphanReferences'
>;

/** Engine payloads + engine plugin selection. */
export type AIMarkdownPipelineProps = Pick<
  AIMarkdownProps,
  'contentPreprocessors' | 'urlTransform' | 'sanitizeSchema' | 'customComponents' | 'enginePlugins'
>;

// Deliberately NON-generic signatures: a fresh object literal is checked
// for excess properties against the concrete parameter type, so passing a
// field from another system is a compile error. A `<T extends …>` version
// would let excess keys slip through whenever the literal shares at least
// one property with the constraint (TS infers T from the literal itself).

/** Freeze a theme fragment. Identity + types + freeze; zero logic. */
export function defineTheme(values: AIMarkdownThemeProps): Readonly<AIMarkdownThemeProps> {
  return Object.freeze(values);
}

/** Freeze a behaviors fragment. Identity + types + freeze; zero logic. */
export function defineBehaviors(values: AIMarkdownBehaviorProps): Readonly<AIMarkdownBehaviorProps> {
  return Object.freeze(values);
}

/** Freeze a pipeline fragment. Identity + types + freeze; zero logic. */
export function definePipeline(values: AIMarkdownPipelineProps): Readonly<AIMarkdownPipelineProps> {
  return Object.freeze(values);
}
