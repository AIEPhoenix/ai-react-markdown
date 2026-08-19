# Custom Components

Override how individual HTML elements are rendered by passing `customComponents` to `<AIMarkdown>`. This is the most common extension point — you'll reach for it whenever you need a chat-specific code block, a link that opens in a new tab, an image that lazy-loads, or any other per-element behavior.

```tsx
import AIMarkdown, { type AIMarkdownCustomComponents } from '@ai-react-markdown/core';

const components: AIMarkdownCustomComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

<AIMarkdown content={markdown} customComponents={components} />;
```

`AIMarkdownCustomComponents` is a re-exported alias of the local Markdown-wrapper `Components` type (a vendored fork of `react-markdown`'s). The available element keys mirror the HTML element names markdown emits: `a`, `blockquote`, `br`, `code`, `em`, `h1`–`h6`, `hr`, `img`, `li`, `ol`, `p`, `pre`, `strong`, `table`, `td`, `th`, `tr`, `ul`, plus GFM (`del`, `input` for task lists), KaTeX wrapper spans, definition lists (`dl`, `dt`, `dd`), and the `mark` element from `==highlight==` syntax.

---

## Recipes

### Lazy-load images

```tsx
const components: AIMarkdownCustomComponents = {
  img: ({ src, alt, title }) => <img src={src} alt={alt ?? ''} title={title} loading="lazy" decoding="async" />,
};
```

The `alt` prop can be undefined for unlabeled images — coerce to `''` for accessibility.

### Open external links in a new tab, keep internal links in-tab

```tsx
const components: AIMarkdownCustomComponents = {
  a: ({ href, children, ...rest }) => {
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
    return (
      <a {...rest} href={href} {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
};
```

### Wrap tables for horizontal scroll on mobile

```tsx
const components: AIMarkdownCustomComponents = {
  table: ({ children }) => (
    <div className="table-scroll-wrapper">
      <table>{children}</table>
    </div>
  ),
};
```

### Render task-list checkboxes as toggleable controls

GFM task lists emit `<input type="checkbox" disabled>` by default. Re-render them as live toggles by intercepting the `input` element:

```tsx
const components: AIMarkdownCustomComponents = {
  input: ({ type, checked, ...rest }) => {
    if (type !== 'checkbox') return <input type={type} {...rest} />;
    return <input type="checkbox" defaultChecked={checked} {...rest} />;
  },
};
```

For full interactivity (persist toggles to state), pair this with [Metadata Context](./metadata-context.md) so the component reads/writes app state without prop drilling.

### Custom code block with copy button (core, no Mantine)

```tsx
import { useAIMarkdownState } from '@ai-react-markdown/core';

function CopyableCode({ children, className }: { children: React.ReactNode; className?: string }) {
  const { streaming } = useAIMarkdownState();
  const text = String(children).replace(/\n$/, '');
  return (
    <pre className={className}>
      {!streaming && <button onClick={() => navigator.clipboard.writeText(text)}>Copy</button>}
      <code>{children}</code>
    </pre>
  );
}

const components: AIMarkdownCustomComponents = {
  pre: ({ children }) => {
    // children is typically a single <code> element from a fenced block
    return <CopyableCode>{children}</CopyableCode>;
  },
};
```

Hiding the copy button while `streaming === true` is a common touch — copying half-finished code is rarely useful and the button flickering as content grows is distracting.

### Add anchor links to headings

```tsx
const components: AIMarkdownCustomComponents = {
  h2: ({ children, id }) => (
    <h2 id={id}>
      {id && (
        <a href={`#${id}`} className="heading-anchor">
          #
        </a>
      )}
      {children}
    </h2>
  ),
};
```

The `id` is auto-prefixed by the library's `documentId` namespace — see [Architecture](./architecture.md#documentid-and-clobber-prefix) for how multi-document pages avoid id collisions.

---

## Reference stability matters

`customComponents` participates in the block-memo cache. The library internally stabilizes it via deep-equal (`useStableValue`), so an inline object will be tolerated — but the deep compare on every render isn't free. The recommended pattern is module scope or `useMemo`:

```tsx
// ⚠️ Re-created every render — internal deep-equal catches it, but pays a deep-compare cost.
<AIMarkdown content={c} customComponents={{ a: MyLink }} />;

// ✅ Stable identity, zero overhead.
const COMPONENTS = { a: MyLink } satisfies AIMarkdownCustomComponents;
<AIMarkdown content={c} customComponents={COMPONENTS} />;
```

The component functions themselves should also be stable. A `function MyLink() {…}` declaration or a `const MyLink = (props) => …` at module scope is fine. Defining the function inside the parent's render body recreates it every frame:

```tsx
// ⚠️ New MyLink reference every render.
function Parent({ content }) {
  const MyLink = (props) => <a {...props} target="_blank" />;
  return <AIMarkdown content={content} customComponents={{ a: MyLink }} />;
}
```

---

## Interaction with Mantine defaults

`@ai-react-markdown/mantine` ships its own `customComponents.pre` that powers code highlighting, Mermaid, and JSON pretty-print. Caller-provided components are **merged on top** of the Mantine defaults — your overrides take precedence:

```tsx
// Mantine handles <pre>, you handle <a>:
<MantineAIMarkdown content={c} customComponents={{ a: MyLink }} />

// Mantine still handles <pre> — your <a> override doesn't affect it.
```

If you supply `pre` yourself, you fully replace Mantine's code-block pipeline:

```tsx
// ⚠️ Disables Mantine's CodeHighlight, Mermaid, JSON pretty-print.
<MantineAIMarkdown content={c} customComponents={{ pre: MyPlainPre }} />
```

That's sometimes what you want (you have your own highlighter) — just be aware of the consequence.

The reverse holds too: because Mantine's `pre` renders the fenced block through its own `CodeHighlight` / Mermaid / JSON pipeline, it does **not** mount the `code` element inside — so a `customComponents.code` override only reaches **inline** code (`` `like this` ``), never fenced blocks. To customize fenced-block rendering under `@ai-react-markdown/mantine`, override `pre` (and take over highlighting), or use the `codeBlock` group prop (`defaultExpanded`, `autoDetectUnknownLanguage`) documented in the package README.

---

## Accessing the underlying mdast/hast node

Most custom components receive `node` as a prop — the hast Element node that this component renders. Use this when you need information beyond the standard HTML attributes. Always optional-chain — `node` can be `undefined` for synthetic elements (e.g. nodes emitted by a custom remark plugin without position info, or library-internal placeholder elements), and `node.position` is itself optional even when `node` is present.

```tsx
const components: AIMarkdownCustomComponents = {
  code: ({ node, className, children }) => {
    const language = className?.replace('language-', '');
    const sourceOffset = node?.position?.start?.offset;
    // …use language and sourceOffset for analytics, syntax highlighting, etc.
    return <code className={className}>{children}</code>;
  },
};
```

`node.position` tracks the source-level location of the element — useful for selective behaviors (e.g. "only show the line number for code blocks in the first 100 chars of the document").

### Generating ids that share the document namespace

The library namespaces every clobberable attribute (`id="…"` / `href="#…"`) with a per-document prefix so footnote anchors and hash hrefs don't collide across `<AIMarkdown>` instances. If your custom component emits its own ids — e.g. anchor links on headings — you should use the same prefix instead of inventing one. Read `clobberPrefix` from the document context:

```tsx
import { useAIMarkdownDocument } from '@ai-react-markdown/core';

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const components: AIMarkdownCustomComponents = {
  h2: ({ children }) => {
    const { clobberPrefix } = useAIMarkdownDocument();
    const text = String(children);
    const id = `${clobberPrefix}heading-${slugify(text)}`;
    return (
      <h2 id={id}>
        <a href={`#${id}`} className="heading-anchor">
          #
        </a>
        {children}
      </h2>
    );
  },
};
```

The exact byte form of `clobberPrefix` (long ids get MurmurHash3-shortened to keep HTML compact) is not part of the stability contract — always read it from `useAIMarkdownDocument()`, never recompute from `documentId`.

---

## Footguns

### Don't use Hooks above the early-return boundary of a custom component

Custom components are called by `react-markdown` per node. They can use Hooks like any React component — but every code path must reach the same number of Hook calls in the same order. The usual rules-of-Hooks apply:

```tsx
// ⚠️ Calling a Hook conditionally breaks rules-of-Hooks.
const components: AIMarkdownCustomComponents = {
  a: ({ href }) => {
    if (!href) return null;
    const { colorScheme } = useAIMarkdownTheme(); // Hook after conditional return
    return <a href={href}>{colorScheme}</a>;
  },
};

// ✅ Hooks first, conditional later.
const components: AIMarkdownCustomComponents = {
  a: ({ href }) => {
    const { colorScheme } = useAIMarkdownTheme();
    if (!href) return null;
    return <a href={href}>{colorScheme}</a>;
  },
};
```

### Don't mutate `node.properties` from a custom component

`node` is shared across renders when block-memoization caches a block. Mutating it (`node.properties.className = …`) bleeds into future renders that hit the cache, causing intermittent visual bugs. Treat `node` as read-only.

### Heavy work in render → measure first

Custom components run on every render of their parent block. If a component does expensive work (syntax highlighting, code formatting, large regex), memoize the work by the input(s) that actually drive it:

```tsx
import { useMemo } from 'react';

const components: AIMarkdownCustomComponents = {
  code: ({ children }) => {
    const text = String(children);
    const highlighted = useMemo(() => expensiveHighlight(text), [text]);
    return <code dangerouslySetInnerHTML={{ __html: highlighted }} />;
  },
};
```

Note: block-level memoization already caches the **React subtree** of unchanged blocks by source identity, so a block that doesn't change between renders won't re-invoke its custom component at all. Per-component `useMemo` matters mainly when the block _does_ change but the expensive sub-computation should be reused (e.g. content changed but the code language didn't).
