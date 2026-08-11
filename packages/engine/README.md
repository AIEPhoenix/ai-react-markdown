# @ai-react-markdown/engine

Framework-agnostic Markdown engine for [ai-react-markdown](https://github.com/AIEPhoenix/ai-react-markdown) — incremental parsing, LaTeX preprocessing, definition/footnote machinery, and the unified plugin pipeline. Takes Markdown text in, produces a [hast](https://github.com/syntax-tree/hast) tree plus incremental-parse state out; rendering that tree is the job of a framework adapter such as [`@ai-react-markdown/core`](https://www.npmjs.com/package/@ai-react-markdown/core) (React).

> **Status: internal supplier.** This package exists to serve
> `@ai-react-markdown/core` and versions in lockstep with it. Its export
> surface tracks what core consumes and may change in any release —
> **no public API stability is promised before 3.0.0.** If you are
> rendering Markdown in React, depend on `@ai-react-markdown/core`
> instead; this package is interesting to you only if you are building a
> framework adapter of your own.

## Runtime support

Pure computation over strings and syntax trees: no DOM access, no
Node-only APIs, and no unguarded environment reads. Runs in browsers,
Node, workers, and embedded JS runtimes (e.g. Hermes/JavaScriptCore).

## License

MIT
