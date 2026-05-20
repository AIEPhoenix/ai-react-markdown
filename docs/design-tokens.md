# Design Tokens (CSS Custom Properties)

The built-in `default` typography variant is driven entirely by CSS custom properties. **You can retheme the entire output without writing a single line of JavaScript** — override the tokens you care about in your own stylesheet and the library picks them up.

The token surface is also the supported way to make spacing, sizing, color, and typography respond to your design system's existing scale.

---

## Token anchor: `--aim-font-size-root`

All spacing, font-size, and heading tokens are anchored to `--aim-font-size-root`, which the core renderer injects from the `fontSize` prop. The default variant's tokens are defined as `calc(var(--aim-font-size-root) * k)` — meaning **changing the `fontSize` prop proportionally scales every dimension**.

```tsx
<AIMarkdown content={c} fontSize="0.875rem" /> // 14px-ish — everything scales down
<AIMarkdown content={c} fontSize="1.125rem" /> // 18px-ish — everything scales up
```

You only need to override individual tokens when you want non-proportional changes (e.g. tighter spacing without smaller text, larger H1 without bigger body, etc.).

---

## Complete token reference

All tokens are scoped to `.aim-typography-root.default`. Override at that selector (or a more specific one) in your own stylesheet:

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.2);
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 2.5);
  --aim-font-weight-strong: 600;
  --aim-color-anchor: #ff6b6b;
}
```

### Spacing scale

| Token | Default formula | Used by |
|---|---|---|
| `--aim-spacing-xs` | `calc(var(--aim-font-size-root) * 0.625)` | Tight inline gaps |
| `--aim-spacing-sm` | `calc(var(--aim-font-size-root) * 0.75)` | List item margins |
| `--aim-spacing-md` | `calc(var(--aim-font-size-root) * 1)` | Paragraph block margin |
| `--aim-spacing-lg` | `calc(var(--aim-font-size-root) * 1.25)` | Section spacing |
| `--aim-spacing-xl` | `calc(var(--aim-font-size-root) * 1.5)` | Major section spacing |

### Font sizes (inline scale)

| Token | Default formula | Used by |
|---|---|---|
| `--aim-font-size-xs` | `calc(var(--aim-font-size-root) * 0.75)` | Footnotes, attribution |
| `--aim-font-size-sm` | `calc(var(--aim-font-size-root) * 0.875)` | Captions, small labels |
| `--aim-font-size-md` | `calc(var(--aim-font-size-root) * 1)` | Body |
| `--aim-font-size-lg` | `calc(var(--aim-font-size-root) * 1.125)` | Larger inline emphasis |
| `--aim-font-size-xl` | `calc(var(--aim-font-size-root) * 1.25)` | Lead paragraphs |

### Heading sizes

| Token | Default formula |
|---|---|
| `--aim-h1-font-size` | `calc(var(--aim-font-size-root) * 2.125)` |
| `--aim-h2-font-size` | `calc(var(--aim-font-size-root) * 1.625)` |
| `--aim-h3-font-size` | `calc(var(--aim-font-size-root) * 1.375)` |
| `--aim-h4-font-size` | `calc(var(--aim-font-size-root) * 1.125)` |
| `--aim-h5-font-size` | `calc(var(--aim-font-size-root) * 1)` |
| `--aim-h6-font-size` | `calc(var(--aim-font-size-root) * 0.875)` |

The multipliers (`2.125`, `1.625`, …) mirror Mantine's heading scale. Override individually for non-uniform changes.

### Heading metadata

| Token | Default | Notes |
|---|---|---|
| `--aim-h{1..6}-line-height` | varies | Unitless; multiplied by element font-size |
| `--aim-h{1..6}-font-weight` | `var(--aim-font-weight-strong)` | All headings share this by default |

### Shared weight

| Token | Default | Used by |
|---|---|---|
| `--aim-font-weight-strong` | `700` | All headings, `<th>`, `<strong>` |

Lower to `500` or `600` for lighter visual hierarchy. This single token is usually the highest-impact override.

### KaTeX

| Token | Default | Purpose |
|---|---|---|
| `--aim-katex-font-size` | `var(--aim-font-size-root)` | Math formula size — stays at component-root size regardless of parent (blockquote, heading). Set to `1em` for parent-relative scaling. |

### Misc

| Token | Default | Used by |
|---|---|---|
| `--aim-line-height` | unitless | Body line height |
| `--aim-radius-sm` | rem | Code block / image corner radius |
| `--aim-font-family-monospace` | system mono stack | `<code>`, `<pre>` |
| `--aim-font-family-headings` | system body stack | All headings (override to differentiate from body) |

### Colors (light)

Declared on `.aim-typography-root.light`:

| Token | Role |
|---|---|
| `--aim-color-text` | Main body color |
| `--aim-color-dimmed` | Captions, secondary text |
| `--aim-color-anchor` | Link color |
| `--aim-color-border` | Table borders, blockquote left border |
| `--aim-color-code-bg` | Inline code background |
| `--aim-color-code-text` | Inline code foreground |
| `--aim-color-blockquote-bg` | Blockquote background |
| `--aim-color-mark-bg` | `<mark>` (highlight) background |
| `--aim-color-mark-text` | `<mark>` foreground |

### Colors (dark)

Same names, declared on `.aim-typography-root.dark`. Either selector wins based on which class is present.

```css
.aim-typography-root.dark {
  --aim-color-text: #e5e7eb;
  --aim-color-anchor: #60a5fa;
  /* … */
}
```

---

## Common recipes

### "Roomier" reading layout

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.4);
  --aim-spacing-lg: calc(var(--aim-font-size-root) * 1.8);
  --aim-line-height: 1.75;
}
```

### "Compact" chat layout (less vertical space)

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 0.8);
  --aim-spacing-lg: calc(var(--aim-font-size-root) * 1);
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 1.6);
  --aim-h2-font-size: calc(var(--aim-font-size-root) * 1.3);
  --aim-line-height: 1.5;
}
```

### Heavier headings, lighter body strong

```css
.aim-typography-root.default {
  --aim-h1-font-weight: 800;
  --aim-h2-font-weight: 700;
  --aim-font-weight-strong: 600; /* doesn't override per-heading weights above */
}
```

Per-heading weight tokens fall back to `--aim-font-weight-strong`, so overriding `--aim-font-weight-strong` alone affects every heading at once. Override `--aim-h{N}-font-weight` for per-level control.

### Brand-accent link color

```css
.aim-typography-root.light { --aim-color-anchor: #6366f1; }
.aim-typography-root.dark  { --aim-color-anchor: #a5b4fc; }
```

### Different font for headings

```css
.aim-typography-root.default {
  --aim-font-family-headings: 'Source Serif Pro', Georgia, serif;
}
```

### Scope to a single component instance

The selectors above are global. To scope, raise specificity with a parent class:

```css
.chat-message .aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 0.8);
}
```

The wrapper `<div className="chat-message">` could come from your own layout or via a [custom Typography component](./custom-typography.md).

---

## Stability contract

| Surface | Stability under minor versions |
|---|---|
| Token **names** (e.g. `--aim-spacing-md`) | Stable. Removal/rename requires a major bump |
| Token **roles** (which CSS property a token feeds) | Stable |
| Default **values** (multipliers, colors) | May shift under minor bumps as the visual design evolves |

If you depend on a specific computed value, **override the token explicitly** rather than relying on the default. The override locks the value to your specification regardless of future default changes.

```css
/* ⚠️ Trusting the default — may drift under minor bumps. */
.my-app h1 { /* assumes default --aim-h1-font-size is 2.125rem */ }

/* ✅ Locked explicitly — survives any default shift. */
.aim-typography-root.default {
  --aim-h1-font-size: 2rem;
}
```

---

## Where these tokens live in the build

The CSS variables ship in:

```text
@ai-react-markdown/core/typography/default.css   # default variant only
@ai-react-markdown/core/typography/all.css       # every shipped variant
```

Import whichever fits your bundle:

```ts
import '@ai-react-markdown/core/typography/default.css';
// or
import '@ai-react-markdown/core/typography/all.css';
```

If you write a [custom typography component](./custom-typography.md), you can also ship your own CSS file that declares these tokens (or your own) on your custom root selector. The token names themselves are not required when you fully replace the typography — they're a contract specifically between the built-in `default` variant's CSS and consumer overrides.

---

## Footguns

### Overriding `--aim-font-size-root` directly

`--aim-font-size-root` is **injected by the renderer from the `fontSize` prop** — overriding it in CSS works but is fragile (the next render will re-inject the inline style, and React's inline style wins specificity unless you use `!important`). Use the `fontSize` prop instead:

```tsx
// ✅ Correct: use the prop, the root variable is set for you.
<AIMarkdown content={c} fontSize="1rem" />

// ⚠️ Will lose to the inline style React injects.
// .aim-typography-root.default { --aim-font-size-root: 1rem; }
```

### Specificity wars with downstream resets

CSS frameworks (Tailwind reset, Bootstrap, etc.) often emit rules like `h1 { font-size: 2rem; font-weight: 600; }` with the same specificity as `.aim-typography-root.default h1`. Whichever is loaded **later** wins. If your H1 looks wrong, check load order — and if needed, increase specificity:

```css
.aim-typography-root.default h1.aim-typography-root.default h1 { /* won't help */ }

/* Either: */
:where(.aim-typography-root.default) h1 { font-size: var(--aim-h1-font-size); }

/* Or: */
.aim-typography-root.default :is(h1) { font-size: var(--aim-h1-font-size) !important; }
```

The library's own CSS is written without `!important` to play well with consumer overrides — but that cuts both ways when third-party CSS has the same shape.
