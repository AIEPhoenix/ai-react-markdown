import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, AIMarkdown, useColorScheme } from '../_shared/coreMeta';
import {
  defaultAIMarkdownRenderConfig,
  useAIMarkdownRenderState,
  useAIMarkdownMetadata,
  type AIMarkdownRenderConfig,
  type AIMarkdownMetadata,
  type AIMarkdownCustomComponents,
} from '../../src/index';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Extending/TypeScript Generics',
  parameters: {
    docs: {
      description: {
        component:
          '`<AIMarkdown<TConfig, TRenderData>>` takes two generic parameters: `TConfig` extends ' +
          'the render config with your own fields (pair it with a matching `defaultConfig` so ' +
          '`config` can stay partial), and `TRenderData` types the `metadata` object your custom ' +
          'components read back. Consumers read both with `useAIMarkdownRenderState<TConfig>()` ' +
          'and `useAIMarkdownMetadata<TRenderData>()`. **Both hook generics are caller ' +
          'assertions** — TypeScript cannot verify the provider actually supplied that shape, so ' +
          'pin each assertion once in a wrapper hook next to the config definition (the pattern ' +
          'below, and what `@ai-react-markdown/mantine` does). Full guide: ' +
          '`docs/typescript-generics.md`.',
      },
    },
  },
};

export default meta;

// ── 1. Shape: extend the base config with app-specific fields ───────────────
interface DemoConfig extends AIMarkdownRenderConfig {
  showLineNumbers: boolean;
}

// ── 2. Default: required so the `config` prop can stay deeply partial ───────
const defaultDemoConfig: DemoConfig = {
  ...defaultAIMarkdownRenderConfig,
  showLineNumbers: true,
};

// ── 3. Typed metadata carried alongside (but independent of) the config ─────
interface ChatMeta extends AIMarkdownMetadata {
  messageId: string;
}

// ── 4. Wrapper hooks: the ONE place each generic assertion lives ────────────
// Custom components import these instead of sprinkling `<DemoConfig>` /
// `<ChatMeta>` across the codebase — if the shape changes, one file changes.
const useDemoRenderState = () => useAIMarkdownRenderState<DemoConfig>();
const useChatMeta = () => useAIMarkdownMetadata<ChatMeta>();

/**
 * A code renderer driven by BOTH generics: `config.showLineNumbers` (typed via `TConfig`)
 * toggles the gutter, and the footer cites `metadata.messageId` (typed via `TRenderData`).
 * Note the optional chain on metadata — unlike config, it has no default fallback.
 */
function LineNumberedCode({ node, className, children, ...rest }: React.ComponentProps<'code'> & { node?: unknown }) {
  const { config } = useDemoRenderState();
  const chatMeta = useChatMeta();
  const isBlock = typeof className === 'string' && className.startsWith('language-');
  if (!isBlock || !config.showLineNumbers) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  const lines = String(children).replace(/\n$/, '').split('\n');
  return (
    <code className={className} {...rest}>
      {lines.map((line, i) => (
        <span key={i} style={{ display: 'block' }}>
          <span
            style={{
              display: 'inline-block',
              width: '2.5em',
              paddingRight: '1em',
              textAlign: 'right',
              opacity: 0.45,
              userSelect: 'none',
            }}
          >
            {i + 1}
          </span>
          {line}
        </span>
      ))}
      <span style={{ display: 'block', marginTop: 8, opacity: 0.45 }}>
        {`// from message ${chatMeta?.messageId ?? '(no metadata provided)'}`}
      </span>
    </code>
  );
}

const components: AIMarkdownCustomComponents = { code: LineNumberedCode };

const CONTENT = `The renderer below reads \`config.showLineNumbers\` and \`metadata.messageId\`,
both fully typed:

\`\`\`ts
export function fibonacci(n: number): number {
  if (n < 2) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
\`\`\``;

// Module-scope so the reference is stable across renders (metadata is
// intentionally NOT deep-stabilized by the library).
const METADATA: ChatMeta = { messageId: 'msg-42' };

/** Both generics wired explicitly; `config` is partial and deep-merged over `defaultDemoConfig`. */
function TypedDemo({ showLineNumbers }: { showLineNumbers?: boolean }) {
  const colorScheme = useColorScheme();
  return (
    // ── 5. Explicit generic arguments at the provider call site ──
    <AIMarkdown<DemoConfig, ChatMeta>
      content={CONTENT}
      colorScheme={colorScheme}
      defaultConfig={defaultDemoConfig}
      config={{ showLineNumbers }}
      metadata={METADATA}
      customComponents={components}
    />
  );
}

/** Extended config + typed metadata flowing into a custom component, gutter on. */
export const TypedConfigAndMetadata: CoreStory = {
  render: () => <TypedDemo showLineNumbers />,
};

/** Same setup, overriding the extended field through the partial `config` prop. */
export const ExtendedFieldToggledOff: CoreStory = {
  render: () => <TypedDemo showLineNumbers={false} />,
};
