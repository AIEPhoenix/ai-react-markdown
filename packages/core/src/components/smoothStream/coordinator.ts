import { createContext } from 'react';
import type { SmoothCoordinatorInternal } from '@ai-react-markdown/runtime';
export { createSmoothCoordinator, evaluateGateWarn } from '@ai-react-markdown/runtime';
export type { SmoothCoordinator, SmoothCoordinatorInternal, GateWarnVerdict } from '@ai-react-markdown/runtime';

/**
 * Context value provided by `<AIMarkdownDocuments>` (a sibling of the def
 * registry context — the two never reference each other). `null` when
 * outside the wrapper or when the wrapper sets `smoothTurnTaking={false}`;
 * consumers treat `null` as "no coordination, plain smooth behavior".
 */
export interface SmoothCoordinatorContextValue {
  getCoordinator: (documentId: string) => SmoothCoordinatorInternal;
}

export const SmoothCoordinatorContext = createContext<SmoothCoordinatorContextValue | null>(null);
