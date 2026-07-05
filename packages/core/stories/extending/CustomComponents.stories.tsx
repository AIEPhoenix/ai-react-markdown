import React from 'react';
import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';
import { useAIMarkdownRenderState, type AIMarkdownCustomComponents } from '../../src/index';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Extending/Custom Components',
  parameters: {
    docs: {
      description: {
        component:
          'Replace any element renderer via the `customComponents` prop (a re-exported ' +
          "`react-markdown` `Components` map). Each component receives the element's props plus " +
          '`node` (the hast element) — destructure `node` out before spreading onto a DOM node. ' +
          'Define the map at module scope so its identity stays stable across renders (the ' +
          'block-memo cache depends on it).',
      },
    },
  },
};

export default meta;

/** Open external links in a new tab; keep relative links in-tab. */
const linkComponents: AIMarkdownCustomComponents = {
  a: ({ node, href, children, ...rest }) => {
    const external = !!href && /^https?:\/\//.test(href);
    return (
      <a {...rest} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
        {external ? ' ↗' : null}
      </a>
    );
  },
};

export const ExternalLinks: CoreStory = {
  args: {
    content: `An [external link](https://github.com) opens in a new tab and gets a ↗ marker.

A [relative link](/docs/intro) stays in the same tab.`,
  },
  render: (args) => <ThemedAIMarkdown {...args} customComponents={linkComponents} />,
};

/**
 * A copy button on fenced code blocks. Block code is detected by the
 * `language-*` class; inline code is left untouched. The button is hidden while
 * `streaming` (read from `useAIMarkdownRenderState`) so you don't copy a
 * half-arrived snippet.
 */
function CodeWithCopy({ node, className, children, ...rest }: React.ComponentProps<'code'> & { node?: unknown }) {
  const { streaming } = useAIMarkdownRenderState();
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
      {!streaming && (
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(text)}
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
      )}
      <code className={className} {...rest}>
        {children}
      </code>
    </span>
  );
}

const codeComponents: AIMarkdownCustomComponents = { code: CodeWithCopy };

export const CodeWithCopyButton: CoreStory = {
  args: {
    content: `Hover the block for a copy button (inline \`code\` is untouched):

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\``,
  },
  render: (args) => <ThemedAIMarkdown {...args} customComponents={codeComponents} />,
};

/** Lazy-load images and render their title as a caption. */
const imageComponents: AIMarkdownCustomComponents = {
  img: ({ node, src, alt, title, ...rest }) => (
    <figure style={{ margin: '1em 0' }}>
      <img
        {...rest}
        src={src}
        alt={alt ?? ''}
        title={title}
        loading="lazy"
        decoding="async"
        style={{ maxWidth: '100%' }}
      />
      {title ? <figcaption style={{ fontSize: '0.85em', opacity: 0.7 }}>{title}</figcaption> : null}
    </figure>
  ),
};

export const ImagesWithCaptions: CoreStory = {
  args: {
    content: `![Vue logo](https://vuejs.org/images/logo.png "Figure 1 — the title becomes a caption")`,
  },
  render: (args) => <ThemedAIMarkdown {...args} customComponents={imageComponents} />,
};
