/**
 * Where mermaid rejects text this library's users write — pinned as
 * limitations, with the form that works beside each one.
 *
 * KEYED ON "NON-ASCII", NOT ON "CJK", AND THAT IS THE POINT. The set started
 * as a CJK exercise. Measured 2026-09-03 against mermaid 11.16, the lexers
 * that reject `开发分支` reject `développement` and `разработка` in the same
 * slot, with the same error. A corpus keyed on CJK would call the bug fixed
 * the day CJK started working and accented Latin still did not — which is the
 * same keying error this corpus has already made three times (see the
 * corpus-system notes: generator keyed on file layout, document gate keyed on
 * `$$` parity, engine keyed on any unclosed `$$`). `alsoRejects` carries the
 * non-CJK witnesses so the predicate cannot quietly narrow.
 *
 * `cause` separates three different problems that all look like "my CJK
 * broke", because attributing the wrong one is how a limitation gets reported
 * upstream as a CJK bug when it is not one:
 *
 *   identifier-charset   The lexer's identifier class is ASCII-only. ASCII in
 *                        the same slot is accepted; non-ASCII is not. This is
 *                        the real, upstream-reportable class.
 *   label-quoting        mermaid needs the label quoted regardless of script.
 *                        `asciiAccepted: false` — the ASCII form fails too.
 *                        NOT a non-ASCII problem, and included precisely so
 *                        nobody files it as one.
 *   fullwidth-delimiter  A full-width character sits where the grammar wants
 *                        an ASCII delimiter. The parser is right to refuse;
 *                        the case exists because an IME produces `：` for a
 *                        keystroke that produces `:` in a Latin layout, so
 *                        this is the single commonest authoring mistake in
 *                        CJK diagram source.
 *
 * CONFIRMED ON A SECOND IMPLEMENTATION. Everything here was first measured
 * through `mermaid.parse` under jsdom, which is a parser in a fake DOM — a
 * reasonable thing to be sceptical of. Re-checked 2026-09-03 in the hosted
 * Mermaid Live Editor (mermaid.ai/live), which is a different build, a
 * different version (v11.14.0 against our 11.16.1) and an actual RENDER
 * rather than a parse:
 *
 *   sankey        ASCII renders; CJK bare, CJK quoted and `"café"` quoted all
 *                 fail. The "no working form" claim is not a jsdom artefact.
 *   architecture  bare CJK rejected, quoted renders.
 *   wardley       bare CJK rejected, quoted renders.
 *   gitGraph, xychart, requirement — the quoted forms all render.
 *
 * The sankey entry has a THIRD confirmation, on the paid Mermaid Advanced
 * editor (a different product again, checked by the owner by hand on
 * 2026-09-03): a Chinese sankey is rejected there too. Three implementations,
 * two of them rendering rather than parsing, one of them not ours — the
 * "no working form" claim is about mermaid, not about our harness.
 *
 * NOT confirmable there: `railroad`, and likewise cynefin, eventmodeling and
 * swimlane. v11.14.0 rejects their ASCII control too, because those types do
 * not exist in it yet. The railroad entry below therefore rests on 11.16.1
 * alone — a narrower claim than the others, and flagged rather than smoothed
 * over.
 *
 * THE GATE ASSERTS BOTH DIRECTIONS. `rejected` must still be rejected and
 * `accepted` must still parse. The first half is not pedantry: when mermaid
 * fixes one of these, this corpus should go red and be updated, rather than
 * carrying a workaround nobody revisits. A limitation that has quietly
 * stopped being one is how a corpus starts teaching people to write worse
 * source than they need to.
 */

export interface MermaidLimitCase {
  readonly id: string;
  /** The diagram type, matching `MermaidCase.type`. */
  readonly type: string;
  readonly probes: string;
  readonly cause: 'identifier-charset' | 'label-quoting' | 'fullwidth-delimiter';
  /** Whether ASCII in the SAME slot is accepted. False means the rejection is
   *  about syntax rather than about the character set — see `cause`. */
  readonly asciiAccepted: boolean;
  /** The form mermaid rejects. Gated: it must still throw. */
  readonly rejected: string;
  /** The form that works, or `null` when no form does. Gated: must parse. */
  readonly accepted: string | null;
  /** Non-CJK sources rejected the same way, so a CJK-only fix upstream cannot
   *  be mistaken for a fix. Gated: each must still throw. */
  readonly alsoRejects?: readonly string[];
}

export const MERMAID_NON_ASCII_LIMITS: readonly MermaidLimitCase[] = [
  {
    id: 'sankey-node-names',
    type: 'sankey',
    probes: 'the only slot in the set with NO working non-ASCII form',
    cause: 'identifier-charset',
    asciiAccepted: true,
    // Measured: bare, double-quoted, single-quoted and quoted-with-spaces all
    // throw, while the ASCII forms of all four parse. A sankey diagram in this
    // version simply cannot name a node in Chinese, Japanese, Korean, French
    // or Russian. Reproduced on the free Live Editor (v11.14.0) and on the
    // paid Advanced editor — three implementations, so this is mermaid's
    // limit rather than a property of how we call it.
    rejected: `sankey-beta

中文,日本語,10
中文,한국어,5`,
    accepted: null,
    alsoRejects: ['sankey-beta\n\n"中文","英文",10', 'sankey-beta\n\ncafé,thé,10', 'sankey-beta\n\nальфа,бета,10'],
  },
  {
    id: 'gitgraph-branch-name',
    type: 'gitGraph',
    probes: 'branch and checkout take an identifier; quoting turns it into a string',
    cause: 'identifier-charset',
    asciiAccepted: true,
    rejected: `gitGraph
  commit id: "初始提交"
  branch 开发分支
  checkout 开发分支
  commit id: "增加语料"`,
    accepted: `gitGraph
  commit id: "初始提交"
  branch "开发分支"
  checkout "开发分支"
  commit id: "增加语料"`,
    alsoRejects: ['gitGraph\n  commit\n  branch développement', 'gitGraph\n  commit\n  branch разработка'],
  },
  {
    id: 'xychart-axis-items',
    type: 'xychart',
    probes: 'x-axis category names, which are identifiers unless quoted',
    cause: 'identifier-charset',
    asciiAccepted: true,
    rejected: `xychart-beta
  title "月度请求量"
  x-axis [一月, 二月, 三月]
  y-axis "请求数" 0 --> 100
  bar [30, 60, 90]`,
    accepted: `xychart-beta
  title "月度请求量"
  x-axis ["一月", "二月", "三月"]
  y-axis "请求数" 0 --> 100
  bar [30, 60, 90]`,
  },
  {
    id: 'xychart-title',
    type: 'xychart',
    probes: 'the same charset rule one line up, where a bare ASCII title IS accepted',
    cause: 'identifier-charset',
    asciiAccepted: true,
    rejected: `xychart-beta
  title 月度请求量
  x-axis ["一月", "二月"]
  y-axis "请求数" 0 --> 100
  bar [30, 60]`,
    accepted: `xychart-beta
  title "月度请求量"
  x-axis ["一月", "二月"]
  y-axis "请求数" 0 --> 100
  bar [30, 60]`,
  },
  {
    id: 'requirement-name',
    type: 'requirementDiagram',
    probes: 'requirement and element names, quoted to escape the identifier class',
    cause: 'identifier-charset',
    asciiAccepted: true,
    rejected: `requirementDiagram
  requirement 性能要求 {
    id: 1
    text: 首屏小于一秒
    risk: high
    verifymethod: test
  }`,
    accepted: `requirementDiagram
  requirement "性能要求" {
    id: 1
    text: "首屏小于一秒"
    risk: high
    verifymethod: test
  }`,
  },
  {
    id: 'gantt-fullwidth-colon',
    type: 'gantt',
    probes: 'the IME mistake: a full-width colon where the grammar wants an ASCII one',
    cause: 'fullwidth-delimiter',
    // The character class is not the issue — the CJK task NAME is accepted in
    // the working form below. Only the delimiter has to be ASCII.
    asciiAccepted: true,
    rejected: `gantt
  title 语料体系排期
  dateFormat YYYY-MM-DD
  section 设计
  需求梳理 ：a1, 2026-01-01, 5d`,
    accepted: `gantt
  title 语料体系排期
  dateFormat YYYY-MM-DD
  section 设计
  需求梳理 :a1, 2026-01-01, 5d`,
  },
  {
    id: 'architecture-label',
    type: 'architecture',
    probes: 'the LABEL slot, not an identifier one — and it is still ASCII-only unless quoted',
    cause: 'identifier-charset',
    asciiAccepted: true,
    rejected: `architecture-beta
  group ws(cloud)[工作区]
  service corpus(database)[语料] in ws`,
    accepted: `architecture-beta
  group ws(cloud)["工作区"]
  service corpus(database)["语料"] in ws`,
    // `[My Workspace]` with a space is accepted, so the bracket contents are
    // not a bare identifier in the usual sense — the character class is the
    // whole restriction.
    alsoRejects: ['architecture-beta\n  group ws(cloud)[Café]', 'architecture-beta\n  group ws(cloud)[Работа]'],
  },
  {
    id: 'railroad-rule-name',
    type: 'railroad',
    probes: 'the one slot quoting does not rescue — the rescue is to keep the NAME ASCII',
    cause: 'identifier-charset',
    asciiAccepted: true,
    rejected: `railroad-beta
  语言 = oneOrMore(terminal("甲"));`,
    // Quoting the rule name is rejected too (measured). Rule names are internal
    // identifiers and never rendered, so the working diagram keeps them ASCII
    // and puts the CJK where it is actually shown — in the terminals.
    accepted: `railroad-beta
  language = oneOrMore(terminal("中文"));
  content = choice(terminal("代码"), terminal("テキスト"));`,
    alsoRejects: ['railroad-beta\n  "语言" = oneOrMore(terminal("甲"));'],
  },
  {
    id: 'wardley-component-name',
    type: 'wardley',
    probes: 'component and anchor names, which are both the identifier and the visible label',
    cause: 'identifier-charset',
    asciiAccepted: true,
    rejected: `wardley-beta
  title 语料作为一项能力
  anchor 读者 [0.95, 0.60]
  component 渲染结果 [0.85, 0.65]
  读者 -> 渲染结果`,
    accepted: `wardley-beta
  title 语料作为一项能力
  anchor "读者" [0.95, 0.60]
  component "渲染结果" [0.85, 0.65]
  "读者" -> "渲染结果"`,
  },
  {
    id: 'flowchart-bracket-in-label',
    type: 'flowchart',
    probes: 'NOT a script problem — the ASCII form fails identically, and is here to prove it',
    cause: 'label-quoting',
    asciiAccepted: false,
    rejected: `flowchart TD
  A[数组[0]] --> B[响应]`,
    accepted: `flowchart TD
  A["数组[0]"] --> B[响应]`,
    alsoRejects: ['flowchart TD\n  A[arr[0]] --> B[x]', 'flowchart TD\n  A[cache(hot)] --> B[x]'],
  },
  {
    id: 'pie-unquoted-label',
    type: 'pie',
    probes: 'also not a script problem: pie requires quoted labels for ASCII too',
    cause: 'label-quoting',
    asciiAccepted: false,
    rejected: `pie title 分布
  中文 : 55
  英文 : 45`,
    accepted: `pie title 分布
  "中文" : 55
  "英文" : 45`,
    alsoRejects: ['pie title T\n  chinese : 55\n  english : 45'],
  },
];
