# React custom typography

`Typography`, `ExtraStyles` and variant props are React APIs. Vue uses its base stylesheet, wrapper class/style attributes and element slots. See the [Vue guide](../reference/vue.md#minimal-component) and [package setup](getting-started.md).

The `Typography` slot owns the outer presentation of a Markdown instance: its root element, font size, classes, and any surrounding design-system providers. Replace it when the built-in wrapper cannot express the structure you need. For changes limited to colors, spacing, or heading sizes, start with [design tokens](design-tokens.md); those keep the existing wrapper and stylesheet.

A wrapper is part of the renderer's layout contract. It receives resolved theme values and injected CSS variables, and it must render its children intact. The children can contain Markdown blocks, a hidden tail signal, and an optional streaming cursor. A wrapper that drops styles or assumes a single child can break math sizing or cursor placement even if a short paragraph looks correct.

## The Typography contract

The exported type extends `PropsWithChildren`. It supplies `fontSize`, `variant`, `colorScheme`, and `style` in addition to `children`:

```ts
interface AIMarkdownTypographyProps {
  children?: React.ReactNode;
  fontSize: string; // resolved (e.g. '0.9375rem')
  variant?: AIMarkdownVariant; // 'default' | string
  colorScheme?: AIMarkdownColorScheme; // 'light' | 'dark' | string
  style?: React.CSSProperties; // CSS custom properties injected by the React renderer
}
```

The `style` prop is **the critical part**. The React renderer injects CSS custom properties (currently `--aim-font-size-root`, more may be added in future minor versions) through `style`. Your typography component **must** merge `style` onto its root element — otherwise descendant CSS rules that reference `var(--aim-font-size-root)` (including the built-in `default` variant and all design tokens) will fall back to their inherited values.

```tsx
import AIMarkdown, { type AIMarkdownTypographyComponent } from '@ai-markdown/react';

const MyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, colorScheme, style }) => (
  <div
    className={`my-markdown ${colorScheme}`}
    style={{ fontSize, ...style }} // ← spread style here
  >
    {children}
  </div>
);

<AIMarkdown content={markdown} Typography={MyTypography} />;
```

`fontSize` is provided as a separate prop (in addition to being inside `style` as `--aim-font-size-root`) because most consumers want to set `font-size` on the root element directly — and a flat prop is more ergonomic than reading from CSS custom properties at the React level.

---

## Recipes

### Theme-aware wrapper using a design system

```tsx
import type { AIMarkdownTypographyComponent } from '@ai-markdown/react';
import { useTheme } from 'my-design-system';

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

Any custom component rendered inside `<AIMarkdown>` can read `ChatToolbarContext` — this composes cleanly with [Metadata Context](metadata-context.md), though `metadata` is the preferred channel for app data that isn't already a Context.

### Add ARIA landmarks for screen readers

```tsx
const A11yTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <article role="article" aria-label="Assistant message" style={{ fontSize, ...style }}>
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

> `display: contents` removes the wrapper’s layout box. Check the target browser’s accessibility behavior, and use a real layout box with the built-in cursor, whose coordinates depend on its content root. This pattern is for layouts that do not require that cursor geometry.

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
const MultiVariantTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => (
  <div className={`my-typo my-typo--${variant} my-typo--${colorScheme}`} style={{ fontSize, ...style }}>
    {children}
  </div>
);
```

```css
.my-typo--compact {
  line-height: 1.4;
}
.my-typo--compact h1 {
  margin-block: 0.5em;
}
.my-typo--prose {
  line-height: 1.7;
}
.my-typo--prose h1 {
  margin-block: 1.2em;
}
```

```tsx
<AIMarkdown content={c} Typography={MultiVariantTypography} variant="compact" />
<AIMarkdown content={c} Typography={MultiVariantTypography} variant="prose" />
```

The `variant` prop is typed as `'default' | (string & {})` — literal `'default'` plus any string. Pass anything you want; the type system stays helpful for IDE autocompletion of your own variants without locking out arbitrary values.

---

## The `ExtraStyles` slot

`ExtraStyles` is a second, optional wrapper rendered _inside_ the typography wrapper but _outside_ the rendered markdown:

```text
<Typography>
  <ExtraStyles>            // ← optional
    <AIMarkdownContent />
  </ExtraStyles>
</Typography>
```

Use it for CSS scope that should be **co-located with the rendered markdown** but **independent of typography theming**. The Mantine package uses it to scope `@mantine` CSS variable overrides without polluting the typography wrapper.

```tsx
import type { AIMarkdownExtraStylesComponent } from '@ai-markdown/react';

const MyExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="my-markdown-extra-scope">{children}</div>
);

<AIMarkdown content={c} ExtraStyles={MyExtraStyles} />;
```

---

## Mantine: extending vs replacing

`@ai-markdown/react-mantine` ships:

- `MantineAIMarkdownTypography` — Mantine's `<Typography>` with `w="100%"` and `fz={fontSize}`
- `MantineAIMDefaultExtraStyles` — `<div className="aim-mantine-extra-styles">` that activates the package's em-based CSS overrides

Both are exported. You can re-use them, wrap them, or replace them:

```tsx
import { MantineAIMarkdownTypography, MantineAIMDefaultExtraStyles } from '@ai-markdown/react-mantine';

// Wrap Mantine's typography (e.g. to add an outer container)
const WrappedTypography: AIMarkdownTypographyComponent = (props) => (
  <div className="my-outer">
    <MantineAIMarkdownTypography {...props} />
  </div>
);

<MantineAIMarkdown content={c} Typography={WrappedTypography} />;
```

---

## Footguns

### Forgetting to spread `style`

This is the single most common Typography bug. The rendered markdown looks right at the wrapper level but inner elements (KaTeX, code blocks, headings) fall back to inherited values because `var(--aim-font-size-root)` resolves to `<empty>`:

```tsx
// ⚠️ Missing the style spread — descendant CSS variables won't apply.
const Broken: AIMarkdownTypographyComponent = ({ children, fontSize }) => <div style={{ fontSize }}>{children}</div>;

// ✅ Spread style after your own properties (or before — order doesn't matter here).
const Fixed: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <div style={{ fontSize, ...style }}>{children}</div>
);
```

### Changing the rendered root element on every render

The built-in typography component is memoized, but the React adapter does not automatically wrap every caller-provided slot in `memo`. React identifies a component by its function or class reference. Recreating that reference changes the component type, so React can unmount the old subtree and mount a new one, discarding state and caches. Define the slot at module scope; add `memo` only when its prop usage benefits from it.

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

Forward the HTML attributes you intend to expose, not the entire slot-prop object. `fontSize`, `variant`, and `colorScheme` are component configuration, not native `<div>` attributes. Supplying children both in a spread and as JSX children is redundant; it does not make the wrapper disappear.

```tsx
// Avoid forwarding component-only configuration as DOM attributes.
const Broken: AIMarkdownTypographyComponent = (props) => <div {...props}>{props.children}</div>;

const Explicit: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => (
  <div style={{ fontSize, ...style }} data-variant={variant} data-color-scheme={colorScheme}>
    {children}
  </div>
);
```

If you add custom inline values that overlap the injected `style`, choose a spread order deliberately. `style={{ ...ownStyles, ...style }}` preserves the React adapter's injected values. Reversing the order lets your values replace them; that is appropriate only when you intend to take responsibility for the sizing contract.

## Children, DOM structure, and cursor placement

Render `{children}` verbatim. Do not call `Children.only`, assume that the child is `<AIMarkdownContent>`, or clone it to attach a ref. React supplies a Fragment containing the content and cursor slot. `ExtraStyles`, when present, receives that same group.

The built-in cursor finds its content root through its DOM parent. Keep the cursor and rendered blocks beneath the same real element. Wrapping the entire group in one `<div>` works; moving selected children into separate containers or portals can make detection inspect the wrong subtree. A `display: contents` root can help a grid, but it has no ordinary layout box for the cursor's coordinate calculations. Use a regular layout element when combining custom typography with the built-in cursor.

The actual structure is:

```text
Typography root
└─ ExtraStyles root, when supplied
   ├─ rendered Markdown blocks
   ├─ hidden source-tail signal, when needed
   └─ streamingCursor, while streaming is true
```

`ExtraStyles` receives children only. It can read the narrow theme hook if it needs theme data; it does not receive the typography `style` object as a prop. CSS variables reach it through inheritance from the typography root.

## Reusing the default stylesheet with a custom wrapper

The default stylesheet targets `.aim-typography-root`, with token declarations on `.default`, `.light`, and `.dark` variants. A custom wrapper named `.my-markdown` will not activate those selectors just because you imported the stylesheet. Either retain the expected classes or provide your own complete rules:

```tsx
const CompatibleTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => (
  <article
    className={`aim-typography-root ${variant} ${colorScheme}`}
    aria-label="Assistant message"
    style={{ fontSize, ...style }}
  >
    {children}
  </article>
);
```

A custom variant name selects only CSS that you supply. It does not synthesize a new token scale. Likewise, a custom color-scheme string needs corresponding color rules. Test the wrapper with nested lists, blockquotes containing code, formulas inside headings, and a streaming tail; these expose inheritance and child-layout mistakes that plain prose does not.

Implementation references: [`defs.ts`](../../../../packages/react/src/defs.ts), [`Default.tsx`](../../../../packages/react/src/components/typography/Default.tsx), and the `contentBody` composition in [`index.tsx`](../../../../packages/react/src/index.tsx).
