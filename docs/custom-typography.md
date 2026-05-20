# Custom Typography

The `Typography` prop swaps the wrapper component that renders around all markdown output. Use it to integrate with a design system, apply theme-aware fonts/colors, or scope your own CSS.

> Most theming needs are better served by **CSS custom property overrides** — see [Design Tokens](./design-tokens.md). Reach for a custom Typography component only when you need to change the **rendered structure** (e.g. an extra `<div>` for portaling, a Context provider, or non-standard DOM).

---

## The Typography contract

A typography component receives four props and must wrap `children` in its root element:

```ts
interface AIMarkdownTypographyProps {
  children: React.ReactNode;
  fontSize: string;                  // resolved (e.g. '0.9375rem')
  variant?: AIMarkdownVariant;       // 'default' | string
  colorScheme?: AIMarkdownColorScheme; // 'light' | 'dark' | string
  style?: React.CSSProperties;       // CSS custom properties injected by the core renderer
}
```

The `style` prop is **the critical part**. The core renderer injects CSS custom properties (currently `--aim-font-size-root`, more may be added in future minor versions) through `style`. Your typography component **must** merge `style` onto its root element — otherwise descendant CSS rules that reference `var(--aim-font-size-root)` (including the built-in `default` variant and all design tokens) will fall back to their inherited values.

```tsx
import type { AIMarkdownTypographyComponent } from '@ai-react-markdown/core';

const MyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, colorScheme, style }) => (
  <div
    className={`my-markdown ${colorScheme}`}
    style={{ fontSize, ...style }} // ← spread style here
  >
    {children}
  </div>
);

<AIMarkdown content={markdown} Typography={MyTypography} />
```

`fontSize` is provided as a separate prop (in addition to being inside `style` as `--aim-font-size-root`) because most consumers want to set `font-size` on the root element directly — and a flat prop is more ergonomic than reading from CSS custom properties at the React level.

---

## Recipes

### Theme-aware wrapper using a design system

```tsx
import type { AIMarkdownTypographyComponent } from '@ai-react-markdown/core';
import { ThemeProvider, useTheme } from 'my-design-system';

const ThemedTypography: AIMarkdownTypographyComponent = ({ children, fontSize, colorScheme, style }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        fontSize,
        fontFamily: theme.fonts.body,
        color: colorScheme === 'dark' ? theme.colors.textDark : theme.colors.textLight,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
```

### Inject a Context provider above markdown content

```tsx
const ChatContextTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <ChatToolbarContext.Provider value={{ showCopyButtons: true }}>
    <div style={{ fontSize, ...style }}>{children}</div>
  </ChatToolbarContext.Provider>
);
```

Any custom component rendered inside `<AIMarkdown>` can read `ChatToolbarContext` — this composes cleanly with [Metadata Context](./metadata-context.md), though `metadata` is the preferred channel for app data that isn't already a Context.

### Add ARIA landmarks for screen readers

```tsx
const A11yTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <article
    role="article"
    aria-label="Assistant message"
    style={{ fontSize, ...style }}
  >
    {children}
  </article>
);
```

### Add a `display: contents` wrapper for grid layout

When the markdown lives inside a parent grid (e.g. chat messages in a row layout), the default `<div>` wrapper can disrupt grid placement. `display: contents` makes the wrapper transparent to grid layout:

```tsx
const GridFriendlyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <div style={{ display: 'contents', fontSize, ...style }}>{children}</div>
);
```

> Trade-off: `display: contents` removes the element from the layout tree, which can affect accessibility for assistive tech (the wrapper's semantic role is dropped). Use sparingly.

---

## Multiple variants via class names

The built-in `DefaultTypography` exposes `variant` and `colorScheme` as class names on a `<div className="aim-typography-root">`:

```html
<div class="aim-typography-root default light" style="--aim-font-size-root: 0.9375rem">
  <!-- markdown content -->
</div>
```

You can ship multiple typography variants by writing one component that emits class names and shipping CSS that targets each:

```tsx
const MultiVariantTypography: AIMarkdownTypographyComponent = ({
  children, fontSize, variant, colorScheme, style,
}) => (
  <div
    className={`my-typo my-typo--${variant} my-typo--${colorScheme}`}
    style={{ fontSize, ...style }}
  >
    {children}
  </div>
);
```

```css
.my-typo--compact { line-height: 1.4; }
.my-typo--compact h1 { margin-block: 0.5em; }
.my-typo--prose { line-height: 1.7; }
.my-typo--prose h1 { margin-block: 1.2em; }
```

```tsx
<AIMarkdown content={c} Typography={MultiVariantTypography} variant="compact" />
<AIMarkdown content={c} Typography={MultiVariantTypography} variant="prose" />
```

The `variant` prop is typed as `'default' | (string & {})` — literal `'default'` plus any string. Pass anything you want; the type system stays helpful for IDE autocompletion of your own variants without locking out arbitrary values.

---

## The `ExtraStyles` slot

`ExtraStyles` is a second, optional wrapper rendered *inside* the typography wrapper but *outside* the rendered markdown:

```text
<Typography>
  <ExtraStyles>            // ← optional
    <AIMarkdownContent />
  </ExtraStyles>
</Typography>
```

Use it for CSS scope that should be **co-located with the rendered markdown** but **independent of typography theming**. The Mantine package uses it to scope `@mantine` CSS variable overrides without polluting the typography wrapper.

```tsx
import type { AIMarkdownExtraStylesComponent } from '@ai-react-markdown/core';

const MyExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="my-markdown-extra-scope">{children}</div>
);

<AIMarkdown content={c} ExtraStyles={MyExtraStyles} />
```

---

## Mantine: extending vs replacing

`@ai-react-markdown/mantine` ships:

- `MantineAIMarkdownTypography` — Mantine's `<Typography>` with `w="100%"` and `fz={fontSize}`
- `MantineAIMDefaultExtraStyles` — `<div className="aim-mantine-extra-styles">` that activates the package's em-based CSS overrides

Both are exported. You can re-use them, wrap them, or replace them:

```tsx
import {
  MantineAIMarkdownTypography,
  MantineAIMDefaultExtraStyles,
} from '@ai-react-markdown/mantine';

// Wrap Mantine's typography (e.g. to add an outer container)
const WrappedTypography: AIMarkdownTypographyComponent = (props) => (
  <div className="my-outer">
    <MantineAIMarkdownTypography {...props} />
  </div>
);

<MantineAIMarkdown content={c} Typography={WrappedTypography} />
```

---

## Footguns

### Forgetting to spread `style`

This is the single most common Typography bug. The rendered markdown looks right at the wrapper level but inner elements (KaTeX, code blocks, headings) fall back to inherited values because `var(--aim-font-size-root)` resolves to `<empty>`:

```tsx
// ⚠️ Missing the style spread — descendant CSS variables won't apply.
const Broken: AIMarkdownTypographyComponent = ({ children, fontSize }) => (
  <div style={{ fontSize }}>{children}</div>
);

// ✅ Spread style after your own properties (or before — order doesn't matter here).
const Fixed: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <div style={{ fontSize, ...style }}>{children}</div>
);
```

### Changing the rendered root element on every render

Typography is wrapped in React.memo internally via context; an inline JSX root that looks the same but has a new component identity each render defeats this. Define Typography components at module scope.

```tsx
// ⚠️ A new MyTypography reference every render = full re-render of the markdown tree.
function App() {
  const MyTypography: AIMarkdownTypographyComponent = ({ children }) => <div>{children}</div>;
  return <AIMarkdown content={c} Typography={MyTypography} />;
}

// ✅ Module-scope.
const MyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <div style={{ fontSize, ...style }}>{children}</div>
);
function App() {
  return <AIMarkdown content={c} Typography={MyTypography} />;
}
```

### Don't spread `...props` blindly onto the root if you also override children

```tsx
// ⚠️ `children` is spread twice — the second one wins and your wrapper is invisible.
const Broken: AIMarkdownTypographyComponent = (props) => (
  <div {...props}>{props.children}</div>
);
```

The safer pattern is to destructure explicitly:

```tsx
const OK: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => (
  <div style={{ fontSize, ...style }} data-variant={variant} data-color-scheme={colorScheme}>
    {children}
  </div>
);
```
