/**
 * Every diagram type mermaid 11.16 registers, plus sub-variants for the ones
 * a real document actually uses.
 *
 * WHY ONE PER TYPE IS THE FLOOR AND NOT THE TARGET. The previous corpus had
 * 40 copies of one flowchart, which measured flowchart layout forty times and
 * everything else zero times. Diagram types do not share a renderer: a
 * sequence diagram, a gantt chart and a pie chart take different paths
 * through mermaid and produce very different DOM. A regression in any of the
 * thirty types that were absent could not be seen at all.
 *
 * WHY THE COMMON ONES ARE SUBDIVIDED. Within flowchart, a subgraph exercises
 * nested layout that a flat chart never touches; within sequence, `loop` and
 * `alt` create frames, `activate` creates lifelines, and notes create
 * free-floating boxes. Those are different enough to be different cells. The
 * split is by what the RENDERER has to do, not by syntax variety for its own
 * sake.
 *
 * EVERY ENTRY IS PARSE-VERIFIED. `scripts/validate.mjs` feeds each `src`
 * through the installed `mermaid.parse` and fails if any throws. That is what
 * makes "covers 31 types" a fact rather than a claim, and it is what will
 * catch a mermaid upgrade changing syntax under us — several of these types
 * are beta and their grammar does move.
 */

export interface MermaidCase {
  /** Stable id, `<type>-<variant>`. Used in benchmark scenario ids. */
  readonly id: string;
  /** The diagram type as mermaid registers it. One id per type at minimum. */
  readonly type: string;
  /** What this variant makes the renderer do that its siblings do not.
   *  Named `probes` to match the math and code cases — one name per concept
   *  across the corpus, so a consumer can read any case the same way. */
  readonly probes: string;
  readonly src: string;
}

export const MERMAID_CASES: readonly MermaidCase[] = [
  // ── flowchart — the commonest by a wide margin, so the most subdivided ──
  {
    id: 'flowchart-basic',
    type: 'flowchart',
    probes: 'the baseline: a linear chain, top-down',
    src: `flowchart TD
  A[Start] --> B{Is the cache warm?}
  B -->|yes| C[Serve from cache]
  B -->|no| D[Fetch upstream]
  C --> E[Respond]
  D --> E`,
  },
  {
    id: 'flowchart-shapes',
    type: 'flowchart',
    probes: 'every node shape — each is a different SVG path generator',
    src: `flowchart LR
  a[rectangle] --> b(rounded)
  b --> c([stadium])
  c --> d[[subroutine]]
  d --> e[(database)]
  e --> f((circle))
  f --> g>asymmetric]
  g --> h{rhombus}
  h --> i{{hexagon}}
  i --> j[/parallelogram/]
  j --> k[\\parallelogram alt\\]
  k --> l[/trapezoid\\]
  l --> m[\\trapezoid alt/]
  m --> n(((double circle)))`,
  },
  {
    id: 'flowchart-links',
    type: 'flowchart',
    probes: 'every link style — arrows, thickness, dotted, multi-directional',
    src: `flowchart LR
  a --- b
  b --> c
  c -.-> d
  d ==> e
  e --o f
  f --x g
  g <--> h
  h o--o i
  i x--x j
  j -- text --- k
  k -.text.-> l
  l == text ==> m`,
  },
  {
    id: 'flowchart-subgraph',
    type: 'flowchart',
    probes: 'nested subgraphs — a layout pass the flat chart never runs',
    src: `flowchart TB
  subgraph client [Browser]
    direction LR
    ui[UI] --> store[Store]
  end
  subgraph edge [Edge]
    direction TB
    cache[(Cache)]
    subgraph inner [Warm tier]
      hot[(Hot keys)]
    end
    cache --> hot
  end
  subgraph origin [Origin]
    api[API] --> db[(Postgres)]
  end
  store --> cache
  cache --> api`,
  },
  {
    id: 'flowchart-styling',
    type: 'flowchart',
    probes: 'classDef, class assignment, inline style and link styling',
    src: `flowchart LR
  classDef hot fill:#f96,stroke:#333,stroke-width:2px
  classDef cold fill:#9cf,stroke:#333
  a[Hot path]:::hot --> b[Cold path]:::cold
  b --> c[Plain]
  style c fill:#efe,stroke:#6a6
  linkStyle 0 stroke:#f60,stroke-width:3px`,
  },

  // ── sequence — second commonest, and frame-heavy ──
  {
    id: 'sequence-basic',
    type: 'sequenceDiagram',
    probes: 'participants and plain messages',
    src: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: GET /answer
  S-->>C: 200 text/event-stream`,
  },
  {
    id: 'sequence-blocks',
    type: 'sequenceDiagram',
    probes: 'loop / alt / opt / par — each draws a labelled frame',
    src: `sequenceDiagram
  autonumber
  participant C as Client
  participant S as Server
  participant M as Model
  C->>S: POST /chat
  activate S
  loop every chunk
    S->>M: next token
    M-->>S: token
    alt token is a fence opener
      S->>S: buffer until closed
    else ordinary token
      S-->>C: flush
    end
  end
  opt client disconnected
    S->>M: cancel
  end
  par audit
    S->>S: write log
  and metrics
    S->>S: emit counter
  end
  deactivate S`,
  },
  {
    id: 'sequence-notes',
    type: 'sequenceDiagram',
    probes: 'notes, boxes and self-messages — free-floating layout',
    src: `sequenceDiagram
  box rgb(240,240,255) Front of house
    participant U as User
    participant C as Client
  end
  participant S as Server
  Note over U,C: the reader is watching
  U->>C: type a question
  C->>C: debounce
  Note right of C: self-message,<br/>no counterparty
  C->>S: send
  S--)C: stream begins
  Note over S: dashed reply is async`,
  },

  // ── class ──
  {
    id: 'class-basic',
    type: 'classDiagram',
    probes: 'classes, members, visibility markers',
    src: `classDiagram
  class Renderer {
    +string content
    +bool streaming
    -Cache cache
    #reset() void
    +render(chunk: string) Node
  }
  class Cache {
    +get(key) Node
    +set(key, node) void
  }
  Renderer --> Cache`,
  },
  {
    id: 'class-relations',
    type: 'classDiagram',
    probes: 'every relation arrowhead, plus generics and annotations',
    src: `classDiagram
  direction LR
  class Shape {
    <<interface>>
    +area() float
  }
  class Container~T~ {
    +items: List~T~
  }
  Shape <|-- Circle : inheritance
  Shape <|.. Stub : realization
  Container *-- Item : composition
  Container o-- Handle : aggregation
  Circle --> Point : association
  Point ..> Vec : dependency
  A --* B
  C --o D
  E .. F
  G <--> H : two-way`,
  },

  // ── state ──
  {
    id: 'state-basic',
    type: 'stateDiagram-v2',
    probes: 'states and transitions with start and end',
    src: `stateDiagram-v2
  [*] --> Idle
  Idle --> Streaming : first chunk
  Streaming --> Settling : drained
  Settling --> Idle : quiet
  Streaming --> [*] : aborted`,
  },
  {
    id: 'state-composite',
    type: 'stateDiagram-v2',
    probes: 'composite states, fork/join, choice and concurrency',
    src: `stateDiagram-v2
  state Streaming {
    [*] --> Parsing
    Parsing --> Frozen : boundary advanced
    Frozen --> Parsing : tail changed
  }
  state fork <<fork>>
  state join <<join>>
  state pick <<choice>>
  [*] --> fork
  fork --> Streaming
  fork --> Metrics
  Streaming --> join
  Metrics --> join
  join --> pick
  pick --> Done : settled
  pick --> Failed : timed out
  Done --> [*]
  note right of Failed : timeouts are a deadline,\\nnot a duration`,
  },

  // ── entity relationship ──
  {
    id: 'er-basic',
    type: 'erDiagram',
    probes: 'entities, attributes, keys and every cardinality pair',
    src: `erDiagram
  DOCUMENT ||--o{ BLOCK : contains
  BLOCK ||--|{ NODE : "renders to"
  DOCUMENT }o--|| SESSION : "belongs to"
  NODE }|..|{ CACHE_ENTRY : "keyed by"
  DOCUMENT {
    string id PK
    string content
    int version
  }
  BLOCK {
    string id PK
    string documentId FK
    int startOffset
    int endOffset
  }`,
  },

  // ── the remaining registered types, one apiece ──
  {
    id: 'gantt-basic',
    type: 'gantt',
    probes: 'sections, milestones, dependencies and excludes',
    src: `gantt
  title Release 3.0.0
  dateFormat YYYY-MM-DD
  excludes weekends
  section Engine
    Split packages      :done,    split, 2026-08-01, 12d
    Two-model rewrite   :done,    two,   after split, 20d
  section Corpus
    Generate math       :active,  math,  2026-08-31, 3d
    Mermaid coverage    :         merm,  after math, 2d
    Wire consumers      :         wire,  after merm, 3d
  section Release
    Cut 3.0.0           :milestone, rel, after wire, 0d`,
  },
  {
    id: 'pie-basic',
    type: 'pie',
    probes: 'the simplest renderer in mermaid — a useful low bound',
    src: `pie title Where the stream time goes
  "Incremental parse" : 42
  "React reconcile" : 31
  "Layout" : 18
  "Paint" : 9`,
  },
  {
    id: 'git-basic',
    type: 'gitGraph',
    probes: 'branches, merges, cherry-pick and tags',
    src: `gitGraph
  commit id: "v2.9.0"
  branch corpus
  checkout corpus
  commit id: "math generated"
  commit id: "mermaid cases"
  checkout main
  commit id: "hotfix"
  merge corpus tag: "v3.0.0"
  branch next
  commit id: "experiment"`,
  },
  {
    id: 'journey-basic',
    type: 'journey',
    probes: 'the user-journey renderer — scored tasks per actor',
    src: `journey
  title Reading a streamed answer
  section Ask
    Type the question: 5: Reader
    Hit send: 5: Reader
  section Wait
    Watch the first tokens: 4: Reader
    Notice the page jump: 1: Reader
  section Read
    Scroll back up: 3: Reader
    Copy a code block: 4: Reader`,
  },
  {
    id: 'quadrant-basic',
    type: 'quadrantChart',
    probes: 'quadrant axes and plotted points',
    src: `quadrantChart
  title Benchmark cells by what they can see
  x-axis Low cost --> High cost
  y-axis Weak signal --> Strong signal
  quadrant-1 Keep
  quadrant-2 Keep and watch
  quadrant-3 Drop
  quadrant-4 Reconsider
  "throughput-long": [0.3, 0.9]
  "scale-xlong": [0.95, 0.8]
  "code-dense": [0.6, 0.2]
  "cold-medium": [0.1, 0.6]`,
  },
  {
    id: 'requirement-basic',
    type: 'requirementDiagram',
    probes: 'requirements, elements and satisfy/verify relations',
    src: `requirementDiagram
  requirement corpus_coverage {
    id: 1
    text: every supported construct appears at least once
    risk: high
    verifymethod: test
  }
  element math_generated {
    type: generated file
  }
  element mermaid_cases {
    type: authored file
  }
  math_generated - satisfies -> corpus_coverage
  mermaid_cases - satisfies -> corpus_coverage`,
  },
  {
    id: 'mindmap-basic',
    type: 'mindmap',
    probes: 'indentation-driven nesting and per-node shapes',
    src: `mindmap
  root((corpus))
    markdown
      tables
      footnotes
      CJK
    code
      inline
      fenced
    mermaid
      ::icon(fa fa-diagram)
      31 types
    math
      generated
      authored`,
  },
  {
    id: 'timeline-basic',
    type: 'timeline',
    probes: 'sections with multiple events per period',
    src: `timeline
  title Engine milestones
  section 2026 H1
    v1.8.0 : incremental parse on by default
    v2.0.0 : props v2
  section 2026 H2
    v2.3.0 : engine split into three packages
    v2.8.0 : two-model scanner
    v2.9.1 : F28 and the census`,
  },
  {
    id: 'sankey-basic',
    type: 'sankey-beta',
    probes: 'CSV-shaped input — a parser unlike every other type here',
    src: `sankey-beta

Chunks delivered,Parse,50283
Parse,Freeze scanner,50283
Freeze scanner,Reused prefix,48120
Freeze scanner,Reparsed tail,2163
Reused prefix,Commit,48120
Reparsed tail,Commit,2163`,
  },
  {
    id: 'xychart-basic',
    type: 'xychart-beta',
    probes: 'bar and line series on shared axes',
    src: `xychart-beta
  title "Cost by delivery schedule"
  x-axis [2KB, 18KB, 148KB, 1.15MB]
  y-axis "Milliseconds" 0 --> 11000
  bar [18, 41, 229, 5009]
  line [69, 384, 10315, 10999]`,
  },
  {
    id: 'block-basic',
    type: 'block-beta',
    probes: 'explicit column layout with spanning blocks',
    src: `block-beta
  columns 3
  doc["Document"]:3
  block:group1:2
    parse["Parse"]
    freeze["Freeze"]
  end
  render["Render"]
  space:3
  dom["DOM"]:3
  doc --> parse
  freeze --> render
  render --> dom`,
  },
  {
    id: 'packet-basic',
    type: 'packet',
    probes: 'bit-range layout — fixed-grid rendering',
    src: `packet
  title Chunk frame
  0-7: "Version"
  8-15: "Flags"
  16-31: "Sequence"
  32-63: "Offset"
  64-95: "Length"
  96-127: "Checksum"`,
  },
  {
    id: 'kanban-basic',
    type: 'kanban',
    probes: 'columns of cards with metadata',
    src: `kanban
  Todo
    [Wire consumers]
    [Delete sealReleaseEnumerated]@{ ticket: 2.9.2 }
  In progress
    [Corpus rebuild]@{ assigned: 'corpus' }
  Done
    [Math generated layer]
    [Mermaid cases]`,
  },
  {
    id: 'architecture-basic',
    type: 'architecture',
    probes: 'groups, services, icons and edge junctions',
    src: `architecture-beta
  group workspace(cloud)[Workspace]
  service corpus(database)[Corpus] in workspace
  service engine(server)[Engine] in workspace
  service core(server)[Core] in workspace
  service bench(server)[Benchmarks] in workspace
  corpus:R --> L:engine
  corpus:B --> T:bench
  engine:R --> L:core`,
  },
  {
    id: 'radar-basic',
    type: 'radar-beta',
    probes: 'polar axes with multiple curves',
    src: `radar-beta
  title Corpus coverage by area
  axis markdown["Markdown"], code["Code"], math["Math"]
  axis mermaid["Mermaid"], cjk["CJK"], streaming["Streaming"]
  curve before["Before"]{20, 30, 15, 10, 0, 5}
  curve after["After"]{95, 90, 98, 100, 85, 70}
  max 100
  min 0`,
  },
  {
    id: 'treemap-basic',
    type: 'treemap',
    probes: 'nested weighted rectangles',
    src: `treemap-beta
"Corpus"
    "Math"
        "Symbols": 492
        "Functions": 272
        "Macros": 314
    "Mermaid"
        "Cases": 31
    "Code"
        "Languages": 30
    "Markdown"
        "Constructs": 40`,
  },
  {
    id: 'c4-basic',
    type: 'C4Context',
    probes: 'the C4 renderer — boundaries and typed relationships',
    src: `C4Context
  title Streaming a rendered answer
  Person(reader, "Reader", "Watches an answer arrive")
  System_Boundary(app, "Application") {
    Container(ui, "Renderer", "React", "Turns markdown into DOM")
    Container(engine, "Engine", "TypeScript", "Incremental parse")
  }
  System_Ext(model, "Model", "Emits tokens")
  Rel(reader, ui, "reads")
  Rel(ui, engine, "feeds chunks to")
  Rel(model, ui, "streams to", "SSE")`,
  },
  {
    id: 'venn-basic',
    type: 'venn',
    probes: 'set intersections',
    src: `venn-beta
  title What each corpus consumer needs
  set benchmarks ["Benchmarks"]
  set tests ["Tests"]
  set stories ["Stories"]
  union benchmarks, tests ["Deterministic"]`,
  },
  {
    id: 'cynefin-basic',
    type: 'cynefin',
    probes: 'the cynefin domain renderer, with inter-domain transitions',
    src: `cynefin-beta
  title Where each failure lived
  clear "Missing package.json script"
  complicated "Freeze boundary off by a line"
  complex "Superlinearity that was update count"
  chaotic "Force-pushed tags re-firing releases"
  clear --> complicated
  complicated --> complex
  complex --> chaotic`,
  },
  {
    id: 'ishikawa-basic',
    type: 'ishikawa',
    probes: 'fishbone cause categories',
    src: `ishikawa
  title Why the corpus missed constructs
  Method
    "One family of scenarios"
    "Generated from 19 English words"
  Measurement
    "Coverage never asserted"
  Material
    "Five unrelated corpora"
  Machine
    "No parse gate"`,
  },
  {
    id: 'railroad-basic',
    type: 'railroad',
    probes: 'syntax-diagram rendering — a function-call grammar, not EBNF',
    src: `railroad-beta
  language = oneOrMore(terminal("a"));
  content = choice(terminal("code"), terminal("text"));
  fence = sequence(terminal("open"), optional(nonterminal("language")), terminal("close"));`,
  },
  {
    id: 'eventmodeling-basic',
    type: 'eventmodeling',
    probes: 'the event-modeling renderer — a numbered timeframe and one item',
    src: `eventmodeling
  tf 1
  cmd sendMessage "Send message"`,
  },
  {
    id: 'swimlane-basic',
    type: 'swimlane',
    probes: "lane-partitioned flow — flowchart layout with lanes, and the one diagram that reuses another's parser",
    src: `swimlane-beta
  subgraph Client
    ask[send prompt] --> read[render chunk]
  end
  subgraph Server
    open[open stream] --> fwd[forward chunk]
  end
  ask --> open
  fwd --> read`,
  },
  {
    id: 'treeview-basic',
    type: 'treeView',
    probes: 'the file-tree renderer — paths, not indentation',
    src: `treeView-beta
  corpus[Corpus]
  corpus/src[src]
  corpus/scripts[scripts]`,
  },
  {
    id: 'wardley-basic',
    type: 'wardley',
    probes: 'value-chain positioning',
    src: `wardley-beta
  title Corpus as a capability
  anchor Reader [0.95, 0.60]
  component Rendered answer [0.85, 0.65]
  component Corpus [0.40, 0.30]
  component KaTeX [0.30, 0.85]
  Reader -> Rendered answer
  Rendered answer -> Corpus
  Corpus -> KaTeX`,
  },
  {
    id: 'info-basic',
    type: 'info',
    probes: 'the smallest registered diagram — a version banner',
    src: `info`,
  },
];

/** Diagram types covered, derived rather than hand-counted so the number in
 *  the docs cannot drift from the list above. */
export const MERMAID_TYPES: readonly string[] = [...new Set(MERMAID_CASES.map((c) => c.type))];
