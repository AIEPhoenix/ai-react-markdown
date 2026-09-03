/**
 * CJK diagrams — the coverage the base set does not give.
 *
 * WHY THIS IS NOT JUST THE SAME DIAGRAMS WITH TRANSLATED LABELS. Two things
 * genuinely differ, and they differ in opposite directions:
 *
 *  - PARSING. mermaid's lexers accept CJK in most label positions and reject
 *    it in a few identifier positions. Which is which was measured, not
 *    guessed, and the rejections live in `nonAscii.ts` — keyed on "non-ASCII"
 *    rather than "CJK", because accented Latin and Cyrillic are rejected by
 *    the same lexers. Everything in THIS file parses.
 *
 *  - RENDERING, which this corpus's gate cannot see. CJK glyphs are roughly
 *    twice the advance width of Latin ones, wrap at almost every character
 *    rather than at spaces, and fall back to a different font. All of that
 *    lands in label box sizing and layout. The gate runs `mermaid.parse` in
 *    jsdom, where `getBBox` returns zeroes, so none of it is verified here.
 *    These cases exist so a real-browser check, or a person looking at
 *    Storybook, has something to look at — that is a smaller claim than the
 *    rest of the corpus makes, and it is made deliberately.
 *
 *    The width claim itself is not a guess. Measured 2026-09-03 in the hosted
 *    Live Editor at font-size 16: `接收请求` 80px, `缓存是否命中` 120px,
 *    `リクエストを処理` 160px, `업스트림 조회` 110px — a flat 20px per
 *    character across all three scripts, against roughly 8-10px for Latin,
 *    and a mixed label wrapped to two lines at 250px. So the sizing pressure
 *    these cases put on a layout is real; it is only unverified BY THIS GATE.
 *
 * WHY ONE CASE PER SCRIPT FOR FLOWCHART AND MIXED CONTENT ELSEWHERE. Font
 * fallback is per-script: a build that loses the Korean face while keeping
 * the Chinese one is a real regression, and a single mixed diagram would show
 * it as one damaged label among many. Beyond that isolation, mixing is the
 * more honest shape — real documents in this space are mixed — and three
 * copies of one diagram would repeat the mistake the base set's header
 * describes.
 *
 * COVERAGE MIRRORS THE BASE SET CASE FOR CASE: 37 against its 39, differing
 * only by the two types that cannot have a CJK case at all. Every type the
 * base set subdivides is subdivided here on the same axis — sequence into
 * basic / frames / notes, class into members / relations, state into flat /
 * composite — because the sub-variants exist to reach different RENDERER
 * paths, and a CJK label meets those paths separately too. Counting only
 * types would have hidden that: "29 of 31 covered" reads well while the CJK
 * side is shallower than the base on exactly the three commonest types.
 *
 * The two exclusions are real rather than rhetorical:
 *   info     has no text at all — it renders a version banner.
 *   sankey   cannot express a non-ASCII node name in ANY form; bare, and all
 *            three quoting styles, are rejected. Pinned in `nonAscii.ts`.
 *
 * The first draft covered twelve types, on the theory that CJK is only
 * interesting where "text is load-bearing". That theory does not survive the
 * type list: the base set's own header says diagram types do not share a
 * renderer, and they do not share a label renderer either, so the argument
 * for one case per type applies here for the same reason.
 *
 * Several types need their labels QUOTED to accept CJK — architecture,
 * gitGraph, requirement, wardley, xychart. Those are written here in the
 * working form and the rejected bare form is pinned in `nonAscii.ts`, so this
 * file stays "everything parses" and the limitation stays visible.
 */

import type { MermaidCase } from './diagrams.ts';

export const MERMAID_CJK: readonly MermaidCase[] = [
  // ── one per script, same diagram, so font fallback is isolable ──
  {
    id: 'flowchart-zh',
    type: 'flowchart',
    probes: 'Han glyphs at double advance width in every node and edge label',
    src: `flowchart TD
  A[接收请求] --> B{缓存是否命中}
  B -->|命中| C[从缓存返回]
  B -->|未命中| D[回源查询]
  C --> E[返回响应]
  D --> E`,
  },
  {
    id: 'flowchart-ja',
    type: 'flowchart',
    probes: 'kanji, hiragana and katakana in one label — three sub-scripts, one font',
    src: `flowchart TD
  A[リクエスト受信] --> B{キャッシュは有効か}
  B -->|はい| C[キャッシュから応答]
  B -->|いいえ| D[上流へ問い合わせ]
  C --> E[レスポンス返却]
  D --> E`,
  },
  {
    id: 'flowchart-ko',
    type: 'flowchart',
    probes: 'Hangul syllable blocks, which wrap and measure unlike Han or kana',
    src: `flowchart TD
  A[요청 수신] --> B{캐시가 유효한가}
  B -->|예| C[캐시에서 응답]
  B -->|아니오| D[업스트림 조회]
  C --> E[응답 반환]
  D --> E`,
  },

  // ── full-width punctuation, all of which parses (measured) ──
  {
    id: 'flowchart-fullwidth-punctuation',
    type: 'flowchart',
    probes: 'full-width brackets and punctuation INSIDE a label, where they are text and not syntax',
    src: `flowchart TD
  A[缓存（热）命中] --> B[【重要】写回上游]
  B --> C[「引用」与『强调』]
  C --> D[取得・変換〜出力]
  D --> E[状态：成功！继续？]`,
  },
  {
    id: 'flowchart-mixed-scripts',
    type: 'flowchart',
    probes: 'four scripts in one chart plus explicit line breaks — the shape a real answer has',
    src: `flowchart LR
  A["解析 Markdown<br/>マークダウン解析<br/>마크다운 파싱"] --> B[渲染 KaTeX 公式]
  B --> C[输出 HTML]
  subgraph 上流サービス
    D[取得] --> E[변환]
  end
  C --> D`,
  },

  // ── types where text sizes a box or drives layout ──
  {
    id: 'sequence-cjk',
    type: 'sequenceDiagram',
    probes: 'CJK participants, aliases, messages, frames and a spanning note',
    src: `sequenceDiagram
  participant U as 用户
  participant G as ゲートウェイ
  participant S as 서버
  U->>G: 发起请求
  activate G
  G->>S: 転送する
  loop 每秒重试
    S-->>G: 처리 중
  end
  alt 成功
    S-->>G: 応答データ
    G-->>U: 返回结果
  else 失败
    S-->>G: エラー
    G-->>U: 오류 반환
  end
  deactivate G
  Note over U,S: 三种文字混排的时序图`,
  },
  {
    id: 'sequence-blocks-cjk',
    type: 'sequenceDiagram',
    probes: 'opt / par / autonumber under CJK — frame labels that size the frame itself',
    src: `sequenceDiagram
  autonumber
  participant C as 客户端
  participant S as 服务端
  participant M as 모델
  C->>S: POST /chat
  activate S
  loop 每个分片
    S->>M: 下一个 token
    M-->>S: token
    alt token 是围栏开头
      S->>S: 缓冲到闭合为止
    else 普通 token
      S-->>C: 冲刷
    end
  end
  opt 客户端已断开
    S->>M: 取消生成
  end
  par 审计
    S->>S: 写日志
  and 指标
    S->>S: 上报计数
  end
  deactivate S`,
  },
  {
    id: 'sequence-notes-cjk',
    type: 'sequenceDiagram',
    probes: 'participant box, self-message, a wrapped note and an async reply — free-floating CJK',
    src: `sequenceDiagram
  box rgb(240,240,255) 前台
    participant U as 用户
    participant C as 客户端
  end
  participant S as 서버
  Note over U,C: 读者正看着答案出现
  U->>C: 输入问题
  C->>C: 防抖
  Note right of C: 自己发给自己，<br/>没有对端
  C->>S: 发送
  S--)C: 流式开始
  Note over S: 虚线回复表示异步`,
  },
  {
    id: 'class-cjk',
    type: 'classDiagram',
    probes: 'CJK class names, members and methods — the widest boxes in the set',
    src: `classDiagram
  class 用户 {
    +String 姓名
    +String 邮箱
    +登录() bool
    +注销()
  }
  class 管理员 {
    +封禁(用户) void
  }
  class 注文 {
    +金額 int
  }
  用户 <|-- 管理员
  用户 --> 注文 : 拥有`,
  },
  {
    id: 'class-relations-cjk',
    type: 'classDiagram',
    probes: 'every relation arrowhead plus generics and an annotation, all labelled in CJK',
    src: `classDiagram
  direction LR
  class 形状 {
    <<interface>>
    +面积() float
  }
  class 容器~T~ {
    +条目: List~T~
  }
  形状 <|-- 圆 : 继承
  形状 <|.. 桩 : 实现
  容器 *-- 条目 : 组合
  容器 o-- 句柄 : 聚合
  圆 --> 点 : 关联
  点 ..> 向量 : 依赖
  甲 --* 乙
  丙 --o 丁
  戊 .. 己
  庚 <--> 辛 : 双向`,
  },
  {
    id: 'state-cjk',
    type: 'stateDiagram-v2',
    probes: 'CJK state names and transition labels, mixed across three scripts',
    src: `stateDiagram-v2
  [*] --> 空闲
  空闲 --> 处理中: 受信した
  处理中 --> 完了: 처리 성공
  处理中 --> 失败: 处理异常
  失败 --> 空闲: 重试
  完了 --> [*]`,
  },
  {
    id: 'state-composite-cjk',
    type: 'stateDiagram-v2',
    probes: 'composite states, fork/join/choice and a note — nested CJK inside a drawn container',
    src: `stateDiagram-v2
  state 流式中 {
    [*] --> 解析中
    解析中 --> 已冻结 : 边界前移
    已冻结 --> 解析中 : 尾部变化
  }
  state fork <<fork>>
  state join <<join>>
  state pick <<choice>>
  [*] --> fork
  fork --> 流式中
  fork --> 指标采集
  流式中 --> join
  指标采集 --> join
  join --> pick
  pick --> 完成 : 已静默
  pick --> 失败 : 超时
  完成 --> [*]
  note right of 失败 : 超时是一个期限，不是一段时长`,
  },
  {
    id: 'er-cjk',
    type: 'erDiagram',
    probes: 'CJK entity names and relationship labels on the crow-foot renderer',
    src: `erDiagram
  用户 ||--o{ 订单 : 下单
  订单 ||--|{ 订单项 : 包含
  商品 ||--o{ 订单项 : 出现在
  用户 }|..|{ 优惠券 : 领取`,
  },
  {
    id: 'journey-cjk',
    type: 'journey',
    probes: 'CJK section, task and actor names — actors are rendered as a legend',
    src: `journey
  title 用户接入旅程
  section 注册
    填写表单: 5: 用户
    邮箱验证: 3: 用户, 系统
  section 首次使用
    阅读文档: 4: 用户
    发起调用: 5: 用户, 系统`,
  },
  {
    id: 'mindmap-cjk',
    type: 'mindmap',
    probes: 'deep nesting where every level is a different script',
    src: `mindmap
  root((文字体系))
    中文
      简体字
      繁體字
    日本語
      漢字
      ひらがな
      カタカナ
    한국어
      한글
      한자`,
  },
  {
    id: 'gantt-cjk',
    type: 'gantt',
    probes: 'CJK section and task names against an ASCII-delimited task line',
    src: `gantt
  title 语料体系排期
  dateFormat YYYY-MM-DD
  axisFormat %m-%d
  section 设计
  需求梳理 :done, a1, 2026-01-01, 5d
  方案评审 :active, a2, after a1, 3d
  section 实现
  生成器 :a3, after a2, 7d
  门禁接入 :a4, after a3, 4d`,
  },
  {
    id: 'pie-cjk',
    type: 'pie',
    probes: 'CJK slice labels, which pie requires quoted — as it does ASCII ones',
    src: `pie title 语料构成
  "中文用例" : 45
  "日本語ケース" : 30
  "한국어 사례" : 25`,
  },
  {
    id: 'timeline-cjk',
    type: 'timeline',
    probes: 'CJK events, including two on one period',
    src: `timeline
  title 版本历程
  2026-01 : 首个版本
  2026-05 : 增量解析
  2026-08 : 引擎拆分 : 双模型重构`,
  },
  {
    id: 'quadrant-cjk',
    type: 'quadrantChart',
    probes: 'CJK axis ends, quadrant names and point labels — four label systems at once',
    src: `quadrantChart
  title 工作优先级
  x-axis 低成本 --> 高成本
  y-axis 低收益 --> 高收益
  quadrant-1 优先推进
  quadrant-2 排期规划
  quadrant-3 暂不投入
  quadrant-4 顺手完成
  语料体系: [0.3, 0.8]
  基准重做: [0.7, 0.4]`,
  },
  {
    id: 'block-cjk',
    type: 'block-beta',
    probes: 'CJK in quoted block labels, including a spanning block',
    src: `block-beta
  columns 3
  A["输入"] B["処理"] C["출력"]
  D["缓存层 · キャッシュ · 캐시"]:3`,
  },

  // ── every remaining type that can carry CJK ──────────────────────────────
  //
  // Built from each type's own syntax in `diagrams.ts` rather than from
  // memory, then parse-checked one at a time. Five of them needed quoting
  // that the ASCII originals did not; the bare forms are pinned as
  // limitations rather than silently avoided.
  {
    id: 'gitgraph-cjk',
    type: 'gitGraph',
    probes: 'CJK branch names, commit ids and tags — branch names must be quoted',
    src: `gitGraph
  commit id: "初版发布"
  branch "语料分支"
  checkout "语料分支"
  commit id: "数式コーパス"
  commit id: "머메이드 사례"
  checkout main
  commit id: "紧急修复"
  merge "语料分支" tag: "v3.0.0"`,
  },
  {
    id: 'requirement-cjk',
    type: 'requirementDiagram',
    probes: 'CJK requirement and element names, quoted, with a CJK relationship',
    src: `requirementDiagram
  requirement "语料覆盖率" {
    id: 1
    text: "每个受支持的构造至少出现一次"
    risk: high
    verifymethod: test
  }
  element "数式生成层" {
    type: "生成文件"
  }
  "数式生成层" - satisfies -> "语料覆盖率"`,
  },
  {
    id: 'xychart-cjk',
    type: 'xychart-beta',
    probes: 'CJK axis categories and titles, all quoted — bare ones are rejected',
    src: `xychart-beta
  title "按交付方式的成本"
  x-axis ["二千字节", "十八千字节", "一百四十八千字节"]
  y-axis "毫秒" 0 --> 11000
  bar [18, 41, 229]
  line [69, 384, 10315]`,
  },
  {
    id: 'packet-cjk',
    type: 'packet',
    probes: 'CJK field names in a fixed-width bit layout — the tightest boxes in the set',
    src: `packet
  title 分片帧结构
  0-7: "版本"
  8-15: "标志位"
  16-31: "シーケンス"
  32-63: "오프셋"`,
  },
  {
    id: 'kanban-cjk',
    type: 'kanban',
    probes: 'CJK column and card text, including a card with metadata',
    src: `kanban
  待办
    [接线五个消费者]
    [删除 sealReleaseEnumerated]@{ ticket: 2.9.2 }
  进行中
    [语料重建]@{ assigned: '语料' }
  已完成
    [数式生成层]
    [머메이드 사례]`,
  },
  {
    id: 'architecture-cjk',
    type: 'architecture',
    probes: 'CJK service and group labels, quoted — the bare form is rejected here too',
    src: `architecture-beta
  group ws(cloud)["工作区"]
  service corpus(database)["语料"] in ws
  service engine(server)["エンジン"] in ws
  service bench(server)["벤치마크"] in ws
  corpus:R --> L:engine
  corpus:B --> T:bench`,
  },
  {
    id: 'radar-cjk',
    type: 'radar-beta',
    probes: 'CJK axis and curve labels rotated around a polygon',
    src: `radar-beta
  title 各领域语料覆盖
  axis md["中文"], code["代码"], math["数式"]
  axis mm["図表"], cjk["한국어"], st["ストリーム"]
  curve before["改前"]{20, 30, 15, 10, 0, 5}
  curve after["改后"]{95, 90, 98, 100, 85, 70}
  max 100
  min 0`,
  },
  {
    id: 'treemap-cjk',
    type: 'treemap',
    probes: 'CJK labels inside area-proportional boxes, where text can exceed its tile',
    src: `treemap-beta
"语料"
    "数式"
        "符号": 492
        "函数": 272
    "図表"
        "用例": 31
    "코드"
        "언어": 30`,
  },
  {
    id: 'c4-cjk',
    type: 'C4Context',
    probes: 'CJK across person, container, boundary and relationship labels',
    src: `C4Context
  title 流式渲染一个答案
  Person(reader, "读者", "看着答案逐步到达")
  System_Boundary(app, "应用") {
    Container(ui, "渲染器", "React", "把 Markdown 变成 DOM")
    Container(engine, "エンジン", "TypeScript", "増分解析")
  }
  System_Ext(model, "모델", "토큰을 생성")
  Rel(reader, ui, "阅读")
  Rel(ui, engine, "投喂分片")
  Rel(model, ui, "流式推送", "SSE")`,
  },
  {
    id: 'venn-cjk',
    type: 'venn',
    probes: 'CJK set labels, which are positioned inside overlapping circles',
    src: `venn-beta
  title 各消费者需要什么
  set bench ["基准"]
  set tests ["テスト"]
  set stories ["스토리"]
  union bench, tests ["确定性"]`,
  },
  {
    id: 'cynefin-cjk',
    type: 'cynefin',
    probes: 'CJK domain items, which wrap inside fixed quadrants',
    src: `cynefin-beta
  title 每类故障住在哪
  clear "缺少 package.json 脚本"
  complicated "冻结边界差一行"
  complex "被误判为超线性的更新次数"
  chaotic "强推 tag 重新触发发布"
  clear --> complicated
  complicated --> complex`,
  },
  {
    id: 'ishikawa-cjk',
    type: 'ishikawa',
    probes: 'CJK causes on angled bones — the only type where labels are rotated',
    src: `ishikawa
  title 语料为何漏掉构造
  Method
    "只有一族场景"
    "由十九个英文词生成"
  Measurement
    "覆盖率从未被断言"
  Material
    "五份互不相干的语料"
  Machine
    "没有解析门禁"`,
  },
  {
    id: 'railroad-cjk',
    type: 'railroad',
    probes: 'CJK terminals in a grammar diagram; rule names stay ASCII by necessity',
    src: `railroad-beta
  language = oneOrMore(terminal("中文"));
  content = choice(terminal("代码"), terminal("テキスト"), terminal("텍스트"));
  fence = sequence(terminal("开"), optional(nonterminal("language")), terminal("闭"));`,
  },
  {
    id: 'eventmodeling-cjk',
    type: 'eventmodeling',
    probes: 'a CJK command label on the event-modelling timeline',
    src: `eventmodeling
  tf 1
  cmd sendMessage "发送消息"`,
  },
  {
    id: 'swimlane-cjk',
    type: 'swimlane',
    probes: 'CJK lane titles and node labels — lane width is driven by the title',
    src: `swimlane-beta
  subgraph 客户端
    ask[发送提示] --> read[渲染分片]
  end
  subgraph 服务端
    open[开启流] --> fwd[转发分片]
  end
  ask --> open
  fwd --> read`,
  },
  {
    id: 'treeview-cjk',
    type: 'treeView',
    probes: 'CJK node labels on ASCII paths — the path is structure, the label is text',
    src: `treeView-beta
  corpus[语料]
  corpus/src[源码]
  corpus/scripts[脚本]`,
  },
  {
    id: 'wardley-cjk',
    type: 'wardley',
    probes: 'CJK component names, quoted, positioned on a value-chain map',
    src: `wardley-beta
  title 语料作为一项能力
  anchor "读者" [0.95, 0.60]
  component "渲染结果" [0.85, 0.65]
  component "语料" [0.40, 0.30]
  component "KaTeX" [0.30, 0.85]
  "读者" -> "渲染结果"
  "渲染结果" -> "语料"
  "语料" -> "KaTeX"`,
  },
];
