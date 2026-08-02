/**
 * Widened `define*` factory for the mantine wrapper (EXECUTION-PLAN §4
 * item 8): identity + mantine prop types + freeze, zero logic. Core
 * factories accept core fields only — passing `codeBlock` to core's
 * `defineBehaviors` is a TS error; this widened factory is the wrapper's
 * one-line obligation.
 *
 * @module define
 */

import type { AIMarkdownBehaviorProps } from '@ai-react-markdown/core';
import type { MantineCodeBlockOptions } from './defs';

/** Behavior-system props packagable at integration time, mantine-widened. */
export interface MantineBehaviorProps extends AIMarkdownBehaviorProps {
  /** The mantine `codeBlock` behavior group (atomic replacement; defaults applied at read time). */
  codeBlock?: Partial<MantineCodeBlockOptions>;
}

// NON-generic on purpose — see core's `define.ts`: a fresh literal is
// excess-property checked against the concrete parameter type.

/** Freeze a mantine behaviors fragment. Identity + types + freeze; zero logic. */
export function defineMantineBehaviors(values: MantineBehaviorProps): Readonly<MantineBehaviorProps> {
  return Object.freeze(values);
}
