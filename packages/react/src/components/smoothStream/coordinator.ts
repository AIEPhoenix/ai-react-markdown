import { createContext } from 'react';
import type { SmoothCoordinator } from '@ai-markdown/core';
export { createSmoothCoordinator, evaluateGateWarn } from '@ai-markdown/core';
export type { SmoothCoordinator, GateWarnVerdict } from '@ai-markdown/core';

/**
 * Context value provided by `<AIMarkdownDocuments>` (a sibling of the def
 * registry context — the two never reference each other). `null` when
 * outside the wrapper or when the wrapper sets `smoothTurnTaking={false}`;
 * consumers treat `null` as "no coordination, plain smooth behavior".
 */
export interface SmoothCoordinatorContextValue {
  getCoordinator: (documentId: string) => SmoothCoordinator;
}

export const SmoothCoordinatorContext = createContext<SmoothCoordinatorContextValue | null>(null);
