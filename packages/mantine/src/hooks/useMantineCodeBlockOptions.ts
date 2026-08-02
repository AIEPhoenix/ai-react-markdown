/**
 * Narrow hook for the mantine `codeBlock` behavior group.
 *
 * This is THE single type-assertion site for the group (the pattern that
 * retires the public caller-asserted `TConfig` generic): the opaque
 * extension record from `useAIMarkdownBehaviors()` is narrowed here, and
 * group defaults are applied here — read sites must consume this hook and
 * never re-apply defaults with bare `??` (multiple read sites duplicating
 * defaults will drift).
 *
 * @module hooks/useMantineCodeBlockOptions
 */

import { useMemo } from 'react';
import { useAIMarkdownBehaviors } from '@ai-react-markdown/core';
import { defaultMantineCodeBlockOptions, type MantineCodeBlockOptions } from '../defs';

/**
 * Read the resolved code-block options from the behaviors context.
 *
 * Group values replace atomically at the transport layer; defaults are
 * filled in here, so a partial group (e.g. `codeBlock={{ defaultExpanded:
 * false }}`) resolves the omitted fields to the shipped defaults.
 *
 * Must be called inside a `<MantineAIMarkdown>` (or any `<AIMarkdown>`
 * wrapped in the mantine Provider stack) — throws outside, same contract
 * as the core narrow hooks.
 */
export function useMantineCodeBlockOptions(): Required<MantineCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this
  // package, contributed by `MantineAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<MantineCodeBlockOptions> | undefined;
  return useMemo(() => ({ ...defaultMantineCodeBlockOptions, ...group }), [group]);
}
