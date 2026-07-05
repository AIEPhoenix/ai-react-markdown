import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, AIMarkdown, useColorScheme } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Robustness/Document Isolation',
  parameters: {
    docs: {
      description: {
        component:
          'Two assistant messages on one page will both contain a footnote `[^1]` and identical ' +
          'heading ids. Naïvely that means clicking `[^1]` in message A could jump to message B. ' +
          'The renderer namespaces every clobberable id (`id`, hash `href`) with a per-document ' +
          'prefix, so footnotes and anchors **never cross-link**. The namespace is keyed by ' +
          '`documentId` — auto-generated via `useId()` when you omit it, or pass an explicit, ' +
          'deterministic value.',
      },
    },
  },
};

export default meta;

const MESSAGE_A = `**Message A.** The architecture is token-driven[^1] and streaming-aware[^2].

[^1]: A's note one — clicking the ref above lands *here*, inside A.
[^2]: A's note two.`;

const MESSAGE_B = `**Message B.** This message also defines a footnote[^1] with the very same label.

[^1]: B's note one — isolated from A despite the identical \`[^1]\` label.`;

function Stack({ idA, idB }: { idA?: string; idB?: string }) {
  const colorScheme = useColorScheme();
  const frame: React.CSSProperties = {
    padding: '12px 16px',
    borderRadius: 10,
    border: `1px solid ${colorScheme === 'dark' ? '#373a40' : '#e9ecef'}`,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={frame}>
        <AIMarkdown content={MESSAGE_A} colorScheme={colorScheme} documentId={idA} />
      </div>
      <div style={frame}>
        <AIMarkdown content={MESSAGE_B} colorScheme={colorScheme} documentId={idB} />
      </div>
    </div>
  );
}

/**
 * No `documentId` supplied — each instance auto-generates a unique id via
 * `useId()`. Click `[^1]` in either message: it scrolls within its own message.
 */
export const AutoIsolated: CoreStory = {
  render: () => <Stack />,
};

/**
 * Explicit, deterministic ids (useful for SSR snapshots or cross-component deep
 * links). The rendered anchor ids are stable and still fully isolated.
 */
export const ExplicitDocumentId: CoreStory = {
  render: () => <Stack idA="message-a" idB="message-b" />,
};
