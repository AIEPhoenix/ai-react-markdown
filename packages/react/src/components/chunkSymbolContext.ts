/**
 * Per-chunk Symbol identity exposed via React context.
 *
 * Each coordinated `<AIMarkdownContent>` allocates a Symbol against its
 * documentId's Registry (via `useId` + `Registry.allocateSymbol`). Inline
 * placeholder components like `FootnoteSupNumber` need to know which chunk
 * they belong to so they can ask the registry for a chunk-scoped value
 * (e.g. the *global* occurrence index of a chunk-local footnote ref).
 *
 * Modelled as a tiny standalone context so consumers can subscribe without
 * dragging the full `MarkdownContent` module into their import graph.
 *
 * Value is `null` outside of a coordinated render (standalone single-doc
 * mode, or pre-allocation paint).
 *
 * @module components/chunkSymbolContext
 */
import { createContext } from 'react';

export const ChunkSymbolContext = createContext<symbol | null>(null);
