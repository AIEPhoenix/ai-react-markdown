'use client';

import type { PropsWithChildren } from 'react';
import { AIMarkdownDocuments } from '../../src/index';

/**
 * Conditionally wraps a benchmark side in AIMarkdownDocuments — the
 * coordination opt-in behind the registry toggle. One shared component so
 * the same-page and isolated variants can't drift into measuring different
 * coordination configurations one copy at a time. (The other half of the
 * opt-in — an explicit `documentId` — stays on the AIMarkdown element,
 * since it must differ per side.)
 */
export const MaybeCoordinated = ({ enabled, children }: PropsWithChildren<{ enabled: boolean }>) =>
  enabled ? <AIMarkdownDocuments>{children}</AIMarkdownDocuments> : <>{children}</>;
