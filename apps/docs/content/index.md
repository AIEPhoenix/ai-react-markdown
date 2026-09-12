# AI Markdown

Render Markdown in React and Vue, including responses that arrive over time. Start with your framework's setup, then follow the guide for the task you need. Both adapters share parsing and document coordination; their components, styling and lifecycle APIs remain framework-specific.

## Choose your framework

| Your application     | Start here                                                            | What it provides                                              |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| React 19             | [React quick start](guides/getting-started.md#react-19)               | Components, hooks and customizable element renderers          |
| Vue 3.5              | [Vue quick start](guides/getting-started.md#vue-35)                   | Components, scoped slots and setup composables                |
| React with Mantine 9 | [Mantine quick start](guides/getting-started.md#react-with-mantine-9) | Theme-aware typography, highlighted code and Mermaid diagrams |

[Compare package and setup requirements](guides/getting-started.md). Choose Mantine when your React application uses that design system. Core and engine are available directly for adapter authors; applications normally install their framework adapter and its peers.

## Build a streaming experience

For a typical chat message, accumulate incoming text into one string and update one renderer. Use document coordination only when one logical document is intentionally displayed by multiple renderers. It resolves shared references and footnotes; it does not join syntax split across component boundaries.

1. Read [Streaming input](guides/streaming-input.md) for source, completion and cancellation semantics.
2. Follow the [React chat recipe](guides/streaming-chat-example.md) or [Vue streaming guide](guides/vue-streaming.md).
3. Add [document coordination](guides/documents-and-references.md) when the layout requires independent sections.

[Open Examples](examples:) to explore the catalogs, or choose a [Playground](examples.md#playgrounds-try-your-own-markdown) to try your own Markdown. Both use Storybook within the website.

<span id="customize-rendering"></span>

## Customize your renderer

Start with [React custom components](guides/custom-components.md), [Vue components and slots](guides/vue-customization.md), or [Mantine configuration](../../../packages/react-mantine/README.md#configuration). Use the [guide directory](guides/index.md) for preprocessing, URL policies, typography and metadata.

<span id="build-an-adapter"></span>

## Go deeper

[Rendering and performance](guides/rendering-and-performance.md) separates shared parsing from framework-specific rendering costs. [Core and engine contracts](guides/api/core-engine-contracts.md) cover adapter ownership and lifecycle. Contributor commands and historical records have their own sidebar groups so they stay available without interrupting application setup.
