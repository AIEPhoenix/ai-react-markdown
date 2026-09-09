# Design Tokens (CSS Custom Properties)

The default React typography stylesheet exposes CSS custom properties for spacing, text sizes, heading hierarchy, colors, and math. Override those properties to adapt Markdown to your design system while retaining the built-in element rules. The tokens belong to the React adapter's default stylesheet; Mantine uses its own typography and scoped Mantine variables.

Most dimensions derive from the instance's `fontSize`. That makes a compact message and a larger article use the same proportions without maintaining separate stylesheets. It does not mean every CSS length scales: the default radius uses `rem`, and several borders and inline paddings use pixels. This guide lists the actual token defaults, their consumers, and the cascade rules that determine whether an override takes effect.

## Token anchor: `--aim-font-size-root`

All spacing, font-size, and heading tokens are anchored to `--aim-font-size-root`, which the React renderer injects from the `fontSize` prop. The default variant's tokens are defined as `calc(var(--aim-font-size-root) * k)` — meaning **changing `fontSize` scales the dimensions expressed through the root token**.

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

| Token              | Default formula                           | Used by                                                       |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------- |
| `--aim-spacing-xs` | `calc(var(--aim-font-size-root) * 0.625)` | Heading/image gaps, code padding, table vertical padding      |
| `--aim-spacing-sm` | `calc(var(--aim-font-size-root) * 0.75)`  | Table cell horizontal padding                                 |
| `--aim-spacing-md` | `calc(var(--aim-font-size-root) * 1)`     | Block margins for `<hr>`, `<pre>`, lists, tables, blockquotes |
| `--aim-spacing-lg` | `calc(var(--aim-font-size-root) * 1.25)`  | Paragraph bottom margin; blockquote horizontal padding        |
| `--aim-spacing-xl` | `calc(var(--aim-font-size-root) * 1.5)`   | Major section spacing                                         |

### Font sizes (inline scale)

| Token                | Default formula                           | Used by                                            |
| -------------------- | ----------------------------------------- | -------------------------------------------------- |
| `--aim-font-size-xs` | `calc(var(--aim-font-size-root) * 0.75)`  | Inline and block code; keyboard labels             |
| `--aim-font-size-sm` | `calc(var(--aim-font-size-root) * 0.875)` | Table captions, headers, and cells                 |
| `--aim-font-size-md` | `calc(var(--aim-font-size-root) * 1)`     | Body                                               |
| `--aim-font-size-lg` | `calc(var(--aim-font-size-root) * 1.125)` | Blockquote text                                    |
| `--aim-font-size-xl` | `calc(var(--aim-font-size-root) * 1.25)`  | Available scale token; no default element consumer |

### Heading sizes

| Token                | Default formula                           |
| -------------------- | ----------------------------------------- |
| `--aim-h1-font-size` | `calc(var(--aim-font-size-root) * 2.125)` |
| `--aim-h2-font-size` | `calc(var(--aim-font-size-root) * 1.625)` |
| `--aim-h3-font-size` | `calc(var(--aim-font-size-root) * 1.375)` |
| `--aim-h4-font-size` | `calc(var(--aim-font-size-root) * 1.125)` |
| `--aim-h5-font-size` | `calc(var(--aim-font-size-root) * 1)`     |
| `--aim-h6-font-size` | `calc(var(--aim-font-size-root) * 0.875)` |

The multipliers (`2.125`, `1.625`, …) mirror Mantine's heading scale. Override individually for non-uniform changes.

### Heading metadata

| Token                       | Default                          | Notes                              |
| --------------------------- | -------------------------------- | ---------------------------------- |
| `--aim-h{1..6}-line-height` | `1.3, 1.35, 1.4, 1.45, 1.5, 1.5` | Unitless, in h1–h6 order           |
| `--aim-h{1..6}-font-weight` | `var(--aim-font-weight-strong)`  | All headings share this by default |

### Shared weight

| Token                      | Default | Used by                                                                                 |
| -------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `--aim-font-weight-strong` | `700`   | All headings (via `--aim-h*-font-weight`), `<th>` — `<strong>` keeps the browser's bold |

Lower to `500` or `600` for lighter visual hierarchy. This single token is usually the highest-impact override.

### KaTeX

| Token                   | Default                     | Purpose                                                                                                                                |
| ----------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--aim-katex-font-size` | `var(--aim-font-size-root)` | Math formula size — stays at component-root size regardless of parent (blockquote, heading). Set to `1em` for parent-relative scaling. |

### Misc

| Token                         | Default                    | Used by                                            |
| ----------------------------- | -------------------------- | -------------------------------------------------- |
| `--aim-line-height`           | `1.55`                     | Body and code line height                          |
| `--aim-radius-sm`             | `0.25rem`                  | Code, keyboard, and blockquote corner radius       |
| `--aim-font-family-monospace` | system mono stack          | `<code>`, `<pre>`                                  |
| `--aim-font-family-headings`  | `inherit` (the body stack) | All headings (override to differentiate from body) |

### Colors (light)

Declared on `.aim-typography-root.light`:

| Token                       | Role                                  |
| --------------------------- | ------------------------------------- |
| `--aim-color-text`          | Main body color                       |
| `--aim-color-dimmed`        | Captions, secondary text              |
| `--aim-color-anchor`        | Link color                            |
| `--aim-color-border`        | Table borders, blockquote left border |
| `--aim-color-code-bg`       | Inline code background                |
| `--aim-color-code-text`     | Inline code foreground                |
| `--aim-color-blockquote-bg` | Blockquote background                 |
| `--aim-color-mark-bg`       | `<mark>` (highlight) background       |
| `--aim-color-mark-text`     | `<mark>` foreground                   |

### Colors (dark)

Same names, declared on `.aim-typography-root.dark`. Either selector wins based on which class is present.

```css
.aim-typography-root.dark {
  --aim-color-text: #c9d1d9;
  --aim-color-anchor: #58a6ff;
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
.aim-typography-root.light {
  --aim-color-anchor: #6366f1;
}
.aim-typography-root.dark {
  --aim-color-anchor: #a5b4fc;
}
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

| Surface                                            | Stability under minor versions                           |
| -------------------------------------------------- | -------------------------------------------------------- |
| Token **names** (e.g. `--aim-spacing-md`)          | Stable. Removal/rename requires a major bump             |
| Token **roles** (which CSS property a token feeds) | Stable                                                   |
| Default **values** (multipliers, colors)           | May shift under minor bumps as the visual design evolves |

If you depend on a specific computed value, **override the token explicitly** rather than relying on the default. The override locks the value to your specification regardless of future default changes.

```css
/* ⚠️ Trusting the default — may drift under minor bumps. */
.my-app h1 {
  /* assumes default --aim-h1-font-size is 2.125rem */
}

/* ✅ Locked explicitly — survives any default shift. */
.aim-typography-root.default {
  --aim-h1-font-size: 2rem;
}
```

---

## Where these tokens live in the build

The CSS variables ship in:

```text
@ai-markdown/react/typography/default.css   # default variant only
@ai-markdown/react/typography/all.css       # every shipped variant
```

Import whichever fits your bundle:

```ts
import '@ai-markdown/react/typography/default.css';
// or
import '@ai-markdown/react/typography/all.css';
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

Inspect the winning declaration in browser DevTools before increasing specificity. Cascade layers, `!important`, selector specificity, and source order are separate factors; a later rule does not automatically beat a more specific one in the same layer.

The shipped element rules use selectors such as `.aim-typography-root :where(h1)`. The `:where(...)` part adds zero specificity; the root class still contributes one class. A plain `h1` selector is less specific, while an application-scoped selector can deliberately override it:

```css
.chat-message .aim-typography-root {
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 1.8);
}

/* Use an element override only when a token cannot express the change. */
.chat-message .aim-typography-root h1 {
  letter-spacing: -0.02em;
}
```

For token declarations, the built-in `.aim-typography-root.default` has two classes. Add your own scope or load an equal-specificity override after the library stylesheet. Wrapping a selector in `:where()` reduces specificity; it does not increase it. Avoid reaching immediately for `!important`, which makes later application overrides harder to reason about.

## Default color values

The light and dark classes declare the same property names. This table records the current values so a designer can compare a proposed theme without reverse-engineering the compiled CSS:

| Token suffix (`--aim-color-…`) | Light     | Dark        |
| ------------------------------ | --------- | ----------- |
| `text`                         | `inherit` | `#c9d1d9`   |
| `dimmed`                       | `#868e96` | `#8b949e`   |
| `anchor`                       | `#228be6` | `#58a6ff`   |
| `border`                       | `#dee2e6` | `#30363d`   |
| `code-bg`                      | `#f1f3f5` | `#161b22`   |
| `code-text`                    | `inherit` | `#c9d1d9`   |
| `blockquote-bg`                | `#f8f9fa` | `#161b22`   |
| `mark-bg`                      | `#fff3bf` | `#bb800926` |
| `mark-text`                    | `inherit` | `inherit`   |

`inherit` means the visible result depends on the surrounding style, so validate colors against the actual message background. The stylesheet does not load fonts. Set body `font-family` on the root and supply any font assets through your application.

## A predictable override workflow

1. Import the React adapter's typography CSS, then your application stylesheet.
2. Supply a valid absolute font-size value (`15`, `'15px'`, or `'0.9375rem'`) through the component prop. Numeric zero remains zero; an empty string uses the shipped default.
3. Override semantic tokens under an application scope rather than repeating element rules.
4. Check computed values for a heading, a table cell, inline code, and KaTeX in a blockquote.
5. Check both light and dark mode. A color declared on `.light` or `.dark` may compete with a generic variant override of equal specificity.

The root variable is supplied as an inline style. A normal stylesheet declaration will lose to that inline value immediately, not only after the next React render. Custom wrappers must forward `style` to preserve it. See [custom typography](./custom-typography.md) for the wrapper and Fragment contracts.

The maintained source is [`default.scss`](../packages/react/src/components/typography/variants/default.scss). Token tables describe that file's current defaults; they do not promise that every generated or caller-supplied component consumes every token.
