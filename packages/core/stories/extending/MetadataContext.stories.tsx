import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, AIMarkdown, useColorScheme } from '../_shared/coreMeta';
import { useAIMarkdownMetadata, type AIMarkdownCustomComponents } from '../../src/index';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Extending/Metadata Context',
  parameters: {
    docs: {
      description: {
        component:
          '`metadata` is a typed React context for passing app data — callbacks, ids, config — to ' +
          'deeply nested custom components **without prop drilling**. Crucially it lives in a ' +
          'separate context from render state, so rebuilding `metadata` every render (new callback ' +
          'refs and all) does **not** re-render the markdown body or bust the block-memo cache. ' +
          'Read it with `useAIMarkdownMetadata<T>()`, which returns `T | undefined`.',
      },
    },
  },
};

export default meta;

interface ChatMeta {
  onCopyCode: (code: string) => void;
  onCite: (label: string) => void;
}

/** A code block whose Copy button calls a callback carried by `metadata`. */
function MetaCodeBlock({ node, className, children, ...rest }: React.ComponentProps<'code'> & { node?: unknown }) {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  const isBlock = typeof className === 'string' && className.startsWith('language-');
  if (!isBlock) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  const text = String(children).replace(/\n$/, '');
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <button
        type="button"
        onClick={() => meta?.onCopyCode(text)}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          font: '11px ui-monospace, monospace',
          padding: '2px 8px',
          borderRadius: 4,
          border: '1px solid currentColor',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          opacity: 0.7,
        }}
      >
        Copy
      </button>
      <code className={className} {...rest}>
        {children}
      </code>
    </span>
  );
}

/** A citation link `[n](#cite-n)` that calls back instead of navigating. */
function MetaCite({ node, href, children, ...rest }: React.ComponentProps<'a'> & { node?: unknown }) {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  if (href?.startsWith('#cite-')) {
    const label = href.slice('#cite-'.length);
    return (
      <a
        {...rest}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          meta?.onCite(label);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}

const components: AIMarkdownCustomComponents = { code: MetaCodeBlock, a: MetaCite };

const CONTENT = `The result follows from the lemma [1](#cite-1) and the theorem [2](#cite-2).

\`\`\`ts
const total = items.reduce((a, b) => a + b, 0);
\`\`\`

Click **Copy** or a citation — both fire callbacks passed via \`metadata\`.`;

function MetadataDemo() {
  const colorScheme = useColorScheme();
  const [log, setLog] = React.useState<string>('— interact above —');
  // Rebuilt every render with fresh callback identities — and yet the markdown
  // body below is NOT re-rendered, because metadata lives in its own context.
  const metadata: ChatMeta = {
    onCopyCode: (code) => setLog(`Copied ${code.length} chars to clipboard`),
    onCite: (label) => setLog(`Citation [${label}] clicked`),
  };
  return (
    <div>
      <div
        style={{
          marginBottom: 12,
          padding: '6px 12px',
          borderRadius: 6,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
          background: colorScheme === 'dark' ? '#2b2b2b' : '#f1f3f5',
        }}
      >
        last action: {log}
      </div>
      <AIMarkdown content={CONTENT} colorScheme={colorScheme} metadata={metadata} customComponents={components} />
    </div>
  );
}

/** Copy and citation buttons drive a live log via `metadata` callbacks. */
export const CallbacksWithoutPropDrilling: CoreStory = {
  render: () => <MetadataDemo />,
};
