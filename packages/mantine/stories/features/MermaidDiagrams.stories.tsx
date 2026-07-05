import { mantineMetaBase, type MantineMeta, type MantineStory } from '../_shared/mantineMeta';

const meta: MantineMeta = {
  ...mantineMetaBase,
  tags: ['autodocs'],
  title: 'Mantine/Features/Mermaid Diagrams',
  parameters: {
    docs: {
      description: {
        component:
          'A ```` ```mermaid ```` fence renders as a **live SVG diagram** (via the `mermaid` ' +
          'engine), with a toggle to view the raw source and automatic light/dark theming. On a ' +
          'parse error it falls back to showing the source instead of throwing. Core renders the ' +
          'same fence as a plain code block — diagram rendering is a Mantine-package feature.',
      },
    },
  },
};

export default meta;

/** A flowchart. Use the control to switch between the diagram and its source. */
export const Flowchart: MantineStory = {
  args: {
    content: `\`\`\`mermaid
graph TD
    A[User message] --> B{Streaming?}
    B -->|yes| C[Render partial chunks]
    B -->|no| D[Render full document]
    C --> E[Block-memo skips unchanged blocks]
    D --> E
    E --> F[Sanitized HTML output]
\`\`\``,
  },
};

/** A sequence diagram. */
export const SequenceDiagram: MantineStory = {
  args: {
    content: `\`\`\`mermaid
sequenceDiagram
    participant U as User
    participant LLM
    participant R as MantineAIMarkdown
    U->>LLM: prompt
    loop token stream
        LLM-->>R: markdown chunk
        R-->>U: rendered update
    end
\`\`\``,
  },
};

/**
 * Graceful degradation: invalid mermaid source does not crash the renderer — it
 * falls back to displaying the raw source so the user still sees the content.
 */
export const InvalidSourceFallback: MantineStory = {
  args: {
    content: `\`\`\`mermaid
graph TD
    A -->
    this is not valid mermaid syntax {{{
\`\`\``,
  },
};
