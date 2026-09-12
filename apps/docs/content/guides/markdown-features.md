# Markdown features

React and Vue share the parsing engine. Their component, styling and diagram integrations differ; choose a [framework quick start](getting-started.md) before configuring presentation.

## Built-in syntax and normalization

| Feature                               | Behavior                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Markdown blocks and inline formatting | Headings, paragraphs, lists, quotes, links, images, emphasis and code                               |
| GFM                                   | Tables, task lists, strikethrough, autolinks and footnotes                                          |
| Math                                  | LaTeX normalization followed by KaTeX rendering; import KaTeX CSS in the application                |
| Emoji                                 | Shortcodes such as `:smile:` are converted by the emoji transform                                   |
| Paragraph line breaks                 | Source line breaks become hard breaks; this differs from renderers that join soft lines             |
| CJK delimiters                        | CJK-aware emphasis and strikethrough parsing; typography still belongs to the framework/application |
| Raw HTML                              | Parsed through the guarded HTML path, then sanitized before framework rendering                     |

These stages remain active when `enginePlugins` is an empty array. That prop selects the optional catalog below; it does not disable the base pipeline or sanitization.

## Selectable engine plugins

All five shipped plugins are enabled by default. Passing an array replaces the enabled set. The engine keeps its canonical execution order regardless of the order in your array.

| Export           | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `highlight`      | `==marked text==` syntax; this is text marking, not code syntax highlighting |
| `definitionList` | Definition-list syntax                                                       |
| `removeComments` | Removes HTML comments through the comment-stripping transform                |
| `smartypants`    | Typographic quotes and punctuation, with a CJK-aware quote pass              |
| `pangu`          | Spacing between CJK and half-width characters                                |

React imports catalog objects from `@ai-markdown/react/plugins`; Vue imports them from `@ai-markdown/vue`. For example, select `defaultEnginePlugins.filter((plugin) => plugin !== pangu)` to keep the other default plugins. Keep that array stable until configuration changes.

Only shipped catalog objects are accepted. `enginePlugins` is not an arbitrary remark/rehype plugin extension point. See the [React plugin reference](../reference/react.md#engine-plugins) and [preprocessing guide](content-preprocessors.md) for supported application-level configuration.

## Code blocks and diagrams

The React and Vue adapters render code text. Fences do not execute JavaScript, compile Vue templates or evaluate MDX. Custom renderers are application code and define their own behavior.

Mantine adds code highlighting, JSON display formatting, copy controls and Mermaid diagrams to React. Complete its provider/CSS setup and read [Code blocks and diagrams](mantine-code-blocks.md). Vue has no built-in Mantine or Mermaid integration.

## Math and incomplete input

Use `$x^2$` for inline math and display delimiters for a block. The built-in preprocessor normalizes LaTeX forms before parsing and distinguishes common currency uses. This is a syntax policy, not an unlimited guarantee for ambiguous dollar-sign prose.

Do not split formulas, fences or table rows into separate renderers as network data arrives. Accumulate the source and let one renderer process it. Optional content repair can change what is displayed; configure it deliberately through [content preprocessors](content-preprocessors.md).

## Output policy and references

Sanitization and final URL transformation are separate stages. Custom components are responsible for their own output. Read [URLs and raw HTML](url-sanitization.md) before broadening either policy.

For one logical document spread across independently mounted sections, use [document coordination](documents-and-references.md). It shares definitions and footnote numbering; it does not concatenate syntax across renderer boundaries.
