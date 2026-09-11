# AI Markdown

Render Markdown in React and Vue, including streaming AI responses, math, tables and coordinated references. Choose your framework to start with its installation, stylesheet requirements and public API.

## Choose your framework

| Your application     | Start here                                                       | What it provides                                              |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| React 19             | [React installation and API](../../../packages/react/README.md)  | Components, hooks and customizable element renderers          |
| Vue 3.5              | [Vue installation and API](../../../packages/vue/README.md)      | Components, scoped slots and setup composables                |
| React with Mantine 9 | [Mantine integration](../../../packages/react-mantine/README.md) | Theme-aware typography, highlighted code and Mermaid diagrams |

[Compare packages and setup requirements](../../../docs/getting-started.md) before choosing. React hooks and Mantine providers belong to the React integration; Vue has its own props and composables.

## Build a streaming experience

Start with one accumulated Markdown string per message. Update it as transport deltas arrive; use document coordination only when a logical document intentionally spans multiple renderers.

- [Streaming and performance](../../../docs/streaming-and-performance.md): rendering flags, caching and integration patterns, with framework scope called out.
- [Smooth streaming](../../../docs/smooth-streaming.md): paced output and completion behavior.
- [Cross-chunk coordination](../../../docs/cross-chunk-coordination.md): references shared across separate Markdown units.
- [Interactive examples](./examples.md): explore the React, Vue and Mantine Storybook catalogs.

## Customize rendering

Use the [guide index](../../../docs/README.md) to find recipes for custom components, typography, URL policies, metadata and CJK text. Each guide identifies its framework scope; use the Vue API reference for Vue-specific examples.

## Build an adapter

[Core](../../../packages/core/README.md) owns framework-independent orchestration. [Engine](../../../packages/engine/README.md) owns parsing and tree algorithms. Read their [public contracts](../../../docs/api/core-engine-contracts.md) and the [architecture guide](../../../docs/architecture.md) when implementing another framework adapter.
