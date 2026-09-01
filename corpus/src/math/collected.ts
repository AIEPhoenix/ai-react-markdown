/**
 * Math cases COLLECTED FROM REAL USE, not derived from the engine's source.
 *
 * WHY THIS IS A SEPARATE FILE FROM `authored.ts`. The two have different
 * provenance and different blind spots, and mixing them would lose that.
 *
 * `authored.ts` was written top-down: read `preprocessLaTeX`, find its eight
 * documented behaviours, write a positive case and a boundary negative for
 * each. That method cannot produce a case for a branch the code does not
 * have — and it did not. Section I below is exactly such a case: an author
 * wraps a whole formula in `$…$` and writes the prices inside it as `$1,000`
 * rather than `\$1,000`, so the line carries five dollars that are two
 * delimiters plus three currency symbols. The engine has no repair for that
 * shape, so no amount of reading it would have surfaced the case. Only
 * collection does.
 *
 * These 76 are what remained after removing everything `authored.ts` already
 * covers by BEHAVIOUR rather than by wording — 19 cases dropped that way.
 *
 * SIX EXPECTATIONS, NOT TWO. The imported annotation scheme carries two
 * categories this corpus had no concept of, and both are load-bearing for a
 * disambiguation problem:
 *
 *   `repair`  loosely written but structurally determinate. The case gives an
 *             input AND an `equivalentTo` form, and what is asserted is that
 *             the two RENDER THE SAME — not that the output equals some
 *             string. That survives an engine change that alters the
 *             intermediate text without changing what the reader sees.
 *
 *   `ambig`   genuinely ambiguous: either reading is acceptable, but one
 *             implementation must be stable and reproducible. This is the
 *             only expectation whose check is a comparison against ITSELF,
 *             and this corpus previously had no way to state it.
 *
 * MEASURED 2026-09-01 against the full pipeline — preprocessLaTeX, the core
 * remark chain, remark-rehype and the core rehype chain, counting rendered
 * KaTeX roots rather than mdast nodes. All but one behave as annotated; that
 * one is kept, marked, and listed in `COLLECTED_KNOWN_GAPS`:
 *
 *   collected-o2  `$x <br> y$` — a whitelisted HTML tag name inside a
 *                 formula. `splitByProtectedRegions` protects the tag, which
 *                 splits the formula across segments, and neither half finds
 *                 its partner. `$a < b > c$` with spaces is fine; `$<a|b>$`
 *                 is fine; it takes the exact `<tag>` shape.
 *
 * A FIX WAS ATTEMPTED AND REVERTED, and what it cost is worth recording so
 * the next attempt does not re-derive it. Three predicates, each refuted by
 * measurement rather than by review:
 *
 *   "the tag contains no `$`, so there is nothing to protect" — false.
 *   Protection also shields the tag from the pipe and bracket-delimiter
 *   rewrites: `<a href="a|b">` became `href="a\vert{}b"` after an unclosed
 *   `$`, and `<a title="\[x\]">` became `title="$$x$$"`.
 *
 *   "the tag sits between an opening and a closing `$` on its line" — breaks
 *   the `<span>$</span>100` idiom, where an author uses tag protection
 *   deliberately to isolate a literal dollar. The closing `</span>` has a `$`
 *   before it and a formula later on the line, so the predicate unprotects it
 *   and the isolated dollar pairs with the wrong partner.
 *
 *   "only bare tags, no attributes" — removes the corruption but not the
 *   `<span>$</span>` breakage, since both of those tags are bare.
 *
 * The pattern underneath: segmentation and `$`-pairing are two models of the
 * same text that disagree, and every predicate above patches the boundary
 * between them rather than reconciling them. A real fix makes pairing aware
 * of segment boundaries instead of deciding which boundaries to drop.
 *
 * It fails SILENTLY — no error, nothing missing, just a literal `$` where a
 * formula belonged. That is why a human reading all 95 rendered cases saw
 * nothing wrong, and why it belongs in a gate rather than in a review.
 */

export interface CollectedMathCase {
  readonly id: string;
  /**
   * What the rendered output must be.
   *
   * `math`   the whole fragment renders as a formula
   * `text`   stays plain text, no formula anywhere (currency included)
   * `mixed`  formula and plain text on one line, judged per segment
   * `raw`    a code context — must survive verbatim
   * `repair` loose but determinate; must render the same as `equivalentTo`
   * `ambig`  either reading is acceptable, but must be reproducible
   */
  readonly expectation: 'math' | 'text' | 'mixed' | 'raw' | 'repair' | 'ambig';
  readonly probes: string;
  readonly src: string;
  /** `repair` only: the normalised form this must render identically to. */
  readonly equivalentTo?: string;
}

export const COLLECTED_MATH_CASES: readonly CollectedMathCase[] = [

  // ── A. 基线与定界符形式 — delimiter forms — how a formula can be opened and closed at all ──
  {
    id: 'collected-a1',
    expectation: 'text',
    probes: '全行零改动',
    src: 'This is a test string without LaTeX or dollar signs.',
  },
  {
    id: 'collected-a4',
    expectation: 'math',
    probes: '块级公式',
    src: 'This is valid: $$x^2 + y^2 = z^2$$',
  },
  {
    id: 'collected-a5',
    expectation: 'mixed',
    probes: '前段行内公式，后段块级公式，两者都要识别',
    src: 'Inline $x^2 + y^2 = z^2$ and block $$E = mc^2$$',
  },
  {
    id: 'collected-a6',
    expectation: 'mixed',
    probes: '两段独立公式，不得跨段配对成 `c$ and second $`',
    src: 'First $a + b = c$ and second $x^2 + y^2 = z^2$',
  },
  {
    id: 'collected-a7',
    expectation: 'mixed',
    probes: '`\\[\\]` 块级，`\\(\\)` 行内',
    src: 'Brackets \\[x^2\\] and parentheses \\(y^2\\)',
  },
  {
    id: 'collected-a8',
    expectation: 'math',
    probes: '块级公式',
    src: 'Brackets \\[z^2\\]',
  },
  {
    id: 'collected-a9',
    expectation: 'mixed',
    probes: '公式含括号与空格，前后是普通英文',
    src: 'The equation is $f(x) = 2x + 3$ where x is a variable.',
  },

  // ── C. 纯货币 — prices that must never be read as math ──
  {
    id: 'collected-c2',
    expectation: 'text',
    probes: '3 个 `$`，含 `+`，公式特征强',
    src: '$50 is $20 + $30',
  },
  {
    id: 'collected-c4',
    expectation: 'text',
    probes: '小数金额',
    src: 'Total: $29.50 plus tax',
  },
  {
    id: 'collected-c5',
    expectation: 'text',
    probes: '4 个 `$` 加 `+` 加 `=`，本组最强的假阳性诱饵',
    src: '- **Total Savings**: $500 + $200 + $150 = $850',
  },
  {
    id: 'collected-c6',
    expectation: 'text',
    probes: '3 个金额，含括号与句号收尾',
    src: 'The total amount invested is $1157.90 (existing amount) + $500 (new investment) = $1657.90.',
  },
  {
    id: 'collected-c7',
    expectation: 'text',
    probes: '不得强制要求千分位；感叹号收尾',
    src: 'You can win $1000000 or even $9999999.99!',
  },
  {
    id: 'collected-c8',
    expectation: 'text',
    probes: '3 个金额，逗号收尾',
    src: 'Bitcoin: $0.00001234, Gas: $3.999, Rate: $1.234567890',
  },
  {
    id: 'collected-c9',
    expectation: 'text',
    probes: '行首金额，`k` 小写后缀，`M` 大写后缀',
    src: '$250k is 25% of $1M',
  },
  {
    id: 'collected-c10',
    expectation: 'text',
    probes: '4 个金额，K/M/B 后缀混用',
    src: 'Revenue: $5M to $10M, funding: $1.5B, price: $5K',
  },

  // ── D. 货币与公式同行 — a price and a formula on one line, in both orders ──
  {
    id: 'collected-d1',
    expectation: 'mixed',
    probes: '`$x^2$` 是公式，`$50` 是货币',
    src: 'LaTeX $x^2$ and price $50',
  },
  {
    id: 'collected-d2',
    expectation: 'mixed',
    probes: '同 D1',
    src: 'Formula $x^2$ costs $25',
  },
  {
    id: 'collected-d3',
    expectation: 'mixed',
    probes: '只靠「定界符旁不能是空白」会把 `$100 ... z$` 整段吞掉，必须叠加货币模式判断',
    src: 'Price $100 then equation $x + y = z$ then another price $50',
  },
  {
    id: 'collected-d4',
    expectation: 'math',
    probes: '开定界符后是数字 2，但 `2n` 不构成完整货币模式，仍应识别为公式',
    src: '- **Goldbach Conjecture**: $2n = p + q$ (every even integer > 2)',
  },

  // ── E. 转义的 \$ — dollars the author already escaped, including inside a formula ──
  {
    id: 'collected-e3',
    expectation: 'math',
    probes: '外层是公式，内层 `\\$` 渲染为美元符',
    src: 'Calculate $\\text{Total} = \\$500 + \\$200$',
  },
  {
    id: 'collected-e4',
    expectation: 'mixed',
    probes: '同 E3，混在函数定义中',
    src: 'The formula $f(x) = \\$2x$ represents cost',
  },
  {
    id: 'collected-e5',
    expectation: 'mixed',
    probes: '集合记号、竖线、转义美元符三者共存',
    src: 'Set $\\{x \\mid x > \\$0\\}$ for positive prices',
  },

  // ── F. 孤立 $ 与跨行 — a lone $ , and a pair that spans a line break ──
  {
    id: 'collected-f1',
    expectation: 'text',
    probes: '全行只有一个 `$`，无配对对象',
    src: 'This $variable is not escaped',
  },
  {
    id: 'collected-f2',
    expectation: 'text',
    probes: '开定界符后紧跟空白，不成立',
    src: 'A single $ sign should not be converted',
  },
  {
    id: 'collected-f3',
    expectation: 'text',
    probes: '行内公式不得跨行配对，两行都保持原样',
    src: `This has $x
y$ which spans lines`,
  },

  // ── G. 复杂公式内容 — formulas whose own content contains the hazards ──
  {
    id: 'collected-g2',
    expectation: 'math',
    probes: '列表项 + 粗体 + 下标 + 竖线 + `\\left\\right`',
    src: `- **Euler's Totient Function**: $\\phi(n) = n \\prod_{p \\mid n} \\left(1 - \\frac{1}{p}\\right)$`,
  },
  {
    id: 'collected-g3',
    expectation: 'math',
    probes: '两处狄拉克括号，非 ASCII 标题字符',
    src: '- **Schrödinger Equation**: $i\\hbar\\frac{\\partial}{\\partial t}|\\psi\\rangle = \\hat{H}|\\psi\\rangle$',
  },
  {
    id: 'collected-g4',
    expectation: 'math',
    probes: '同行两个下划线，可能被 Markdown 配对成斜体',
    src: '- **Einstein Field Equations**: $G_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}$',
  },
  {
    id: 'collected-g5',
    expectation: 'mixed',
    probes: '4 个下划线、上标、`\\text{}`、嵌套下标',
    src: 'Matrix determinant: $\\det(A) = \\sum_{\\sigma \\in S_n} \\text{sgn}(\\sigma) \\prod_{i=1}^n a_{i,\\sigma(i)}$',
  },

  // ── H. 代码上下文 — every code context, and the seam right after one closes ──
  {
    id: 'collected-h2',
    expectation: 'math',
    probes: '验证围栏状态已正确复位',
    src: 'Outside $x^2$',
  },
  {
    id: 'collected-h3',
    expectation: 'text',
    probes: '同上，复位后按货币处理',
    src: 'Outside $200',
  },
  {
    id: 'collected-h5',
    expectation: 'raw',
    probes: '波浪线围栏与反引号围栏等价',
    src: `~~~python
formula = r"$x^2 + y^2$"
~~~`,
  },
  {
    id: 'collected-h8',
    expectation: 'text',
    probes: '不先屏蔽行内代码，两个 `$lookup` 会配对成假公式',
    src: 'The error "invalid $lookup namespace" occurs when using `$lookup` operator',
  },
  {
    id: 'collected-h9',
    expectation: 'mixed',
    probes: '前段公式，后段原样',
    src: 'Use $x + y$ in math but `$lookup` in code',
  },

  // ── I. 公式内含未转义金额 — the highest-frequency real shape: outer delimiters plus unescaped prices inside ──
  {
    id: 'collected-i1',
    expectation: 'repair',
    probes: '5 个 `$` = 外层 2 + 内部 3；千分位写成 `1{,}000` 以免逗号后被吃掉间距',
    src: '- **Simple Interest**: $A = P + Prt = $1,000 + ($1,000)(0.05)(2) = $1,100$',
    equivalentTo: '- **Simple Interest**: $A = P + Prt = \\$1{,}000 + (\\$1{,}000)(0.05)(2) = \\$1{,}100$',
  },
  {
    id: 'collected-i2',
    expectation: 'repair',
    probes: '同 I1，但金额位于 `\\frac{}{}` 的两个参数内部',
    src: '- **ROI**: $\\text{ROI} = \\frac{$1,200 - $1,000}{$1,000} \\times 100\\% = 20\\%$',
    equivalentTo: '- **ROI**: $\\text{ROI} = \\frac{\\$1{,}200 - \\$1{,}000}{\\$1{,}000} \\times 100\\% = 20\\%$',
  },
  {
    id: 'collected-i3',
    expectation: 'repair',
    probes: '3 个 `$` = 外层 2 + 内部 1，本组的最简结构',
    src: 'The cost model is $C = $5 + 2x$ per unit.',
    equivalentTo: 'The cost model is $C = \\$5 + 2x$ per unit.',
  },
  {
    id: 'collected-i4',
    expectation: 'repair',
    probes: '内部金额用 B 后缀而非千分位，货币模式需覆盖 K/M/B',
    src: 'Market cap: $V = $1.5B \\times (1 + g)^n$',
    equivalentTo: 'Market cap: $V = \\$1.5B \\times (1 + g)^n$',
  },
  {
    id: 'collected-i5',
    expectation: 'repair',
    probes: '外层是 `$$`，先按块级定界符锚定，再处理内部三处货币',
    src: '$$\\text{Total} = $500 + $200 + $150$$',
    equivalentTo: '$$\\text{Total} = \\$500 + \\$200 + \\$150$$',
  },
  {
    id: 'collected-i7',
    expectation: 'ambig',
    probes: '既可解释为「公式内含两个金额」，也可解释为「货币 $50 + 公式 $60$」；两种解释都可接受，但同一实现必须稳定可复现',
    src: '$50 + $60$',
  },

  // ── J. 强调符号冲突 — emphasis markers against formula delimiters ──
  {
    id: 'collected-j1',
    expectation: 'mixed',
    probes: '两个 `*` 分处两段公式，不得被配对成 Markdown 强调',
    src: 'Compare $a * b$ and $c * d$ in the same line.',
  },
  {
    id: 'collected-j2',
    expectation: 'mixed',
    probes: '两个 `_` 不得被配对成强调',
    src: 'Compare $a_1$ and $b_2$ in the same line.',
  },
  {
    id: 'collected-j3',
    expectation: 'mixed',
    probes: '同一段公式内两个 `_`，配对区间完全落在公式内',
    src: 'The tensor $T_{\\mu\\nu} = R_{\\mu\\nu}$ is symmetric.',
  },
  {
    id: 'collected-j4',
    expectation: 'math',
    probes: '公式在粗体内部，两种语法边界不重叠',
    src: '**Pythagorean theorem: $a^2 + b^2 = c^2$**',
  },
  {
    id: 'collected-j5',
    expectation: 'math',
    probes: '公式在斜体内部',
    src: `*Euler's identity: $e^{i\\pi} + 1 = 0$*`,
  },
  {
    id: 'collected-j6',
    expectation: 'mixed',
    probes: '`**` 与 `$` 之间无空格，三种强调层级',
    src: '**$\\alpha$** and *$\\beta$* and ***$\\gamma$***',
  },
  {
    id: 'collected-j7',
    expectation: 'math',
    probes: '公式在删除线内部',
    src: '~~Deprecated: $\\lim_{n \\to \\infty} a_n = 0$~~',
  },
  {
    id: 'collected-j8',
    expectation: 'math',
    probes: '星号作为列表标记，不得与公式内容互相干扰',
    src: '* $\\sin^2\\theta + \\cos^2\\theta = 1$',
  },

  // ── K. 块级容器 — a formula inside every block container ──
  {
    id: 'collected-k1',
    expectation: 'math',
    probes: '标题文本中的行内公式',
    src: `见下方三级标题本身。

#### 定理 $E = mc^2$ 的推导`,
  },
  {
    id: 'collected-k2',
    expectation: 'mixed',
    probes: '引用块内行内公式',
    src: '> The Pythagorean theorem states that $a^2 + b^2 = c^2$ for right triangles.',
  },
  {
    id: 'collected-k3',
    expectation: 'math',
    probes: '引用块内跨行块级公式，每行都带 `>` 前缀',
    src: `> 高斯积分：
>
> $$
> \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
> $$`,
  },
  {
    id: 'collected-k4',
    expectation: 'mixed',
    probes: '两层引用嵌套',
    src: `> 外层引用
>
> > 内层引用中的公式 $\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$`,
  },
  {
    id: 'collected-k5',
    expectation: 'mixed',
    probes: '前两项是公式，第三项是货币',
    src: `1. 一次方程：$ax + b = 0$
2. 二次方程：$ax^2 + bx + c = 0$
3. 售价：$1,500 元`,
  },
  {
    id: 'collected-k6',
    expectation: 'math',
    probes: '两级缩进列表内的行内公式',
    src: `- 微积分
  - 导数：$f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$
  - 积分：$\\int_a^b f(x)\\,dx = F(b) - F(a)$
- 代数
  - 判别式：$\\Delta = b^2 - 4ac$`,
  },
  {
    id: 'collected-k7',
    expectation: 'mixed',
    probes: '复选框标记不得干扰公式；第三项是货币',
    src: `- [x] 验证 $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$
- [ ] 验证 $\\prod_{i=1}^{n} i = n!$
- [ ] 核对预算 $12,000`,
  },
  {
    id: 'collected-k8',
    expectation: 'math',
    probes: '块级公式后紧跟水平线，`---` 不得被当作 setext 标题下划线',
    src: `$$a^2 + b^2 = c^2$$

---`,
  },

  // ── L. 表格 — formulas in table cells and headers ──
  {
    id: 'collected-l2',
    expectation: 'mixed',
    probes: '同一行内公式列与货币列并存',
    src: `| 项目 | 公式 | 单价 |
| --- | --- | --- |
| 面积 | $S = \\pi r^2$ | $12.50 |
| 体积 | $V = \\frac{4}{3}\\pi r^3$ | $1,200 |`,
  },
  {
    id: 'collected-l4',
    expectation: 'math',
    probes: '表头单元格内的公式',
    src: `| $x$ | $f(x) = x^2$ |
| --- | --- |
| 1 | 1 |
| 2 | 4 |`,
  },

  // ── M. 跨行块级公式 — display math that spans lines and closes properly ──
  {
    id: 'collected-m2',
    expectation: 'math',
    probes: 'aligned 环境，含 `\\\\` 换行与 `&` 对齐符',
    src: `$$
\\begin{aligned}
\\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\
\\nabla \\cdot \\mathbf{B} &= 0 \\\\
\\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t}
\\end{aligned}
$$`,
  },
  {
    id: 'collected-m3',
    expectation: 'math',
    probes: '转义括号形式的跨行块级公式',
    src: `\\[
\\sum_{k=0}^{n} \\binom{n}{k} = 2^n
\\]`,
  },
  {
    id: 'collected-m4',
    expectation: 'math',
    probes: '列表项内缩进 3 空格的块级公式，且不中断列表编号',
    src: `1. 高斯积分的值为：

   $$
   \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
   $$

2. 后续列表项应保持同一列表，不得被公式打断。`,
  },
  {
    id: 'collected-m5',
    expectation: 'math',
    probes: 'pmatrix 环境，含下标与对齐符',
    src: `$$
A = \\begin{pmatrix}
a_{11} & a_{12} \\\\
a_{21} & a_{22}
\\end{pmatrix}
$$`,
  },

  // ── N. 链接与图片 — formulas in link text, alt text, and URLs containing $ ──
  {
    id: 'collected-n1',
    expectation: 'mixed',
    probes: '公式作为链接文本',
    src: 'See [$E = mc^2$](https://example.com/relativity) for details.',
  },
  {
    id: 'collected-n2',
    expectation: 'text',
    probes: 'URL 中的 `$` 是查询参数值，不得配对',
    src: 'Query the [price API](https://example.com/api?min=$100&max=$500) endpoint.',
  },
  {
    id: 'collected-n3',
    // DIVERGES FROM THE UPSTREAM ANNOTATION, which says `mixed`. Its own note
    // says whether the alt text renders as a formula is implementation-
    // dependent, and that is the definition of `ambig`, not of `mixed`. What
    // it actually requires — that the image syntax survives — holds here.
    expectation: 'ambig',
    probes: 'alt 文本中的公式，是否渲染取决于实现，但不得破坏图片语法',
    src: '![公式 $y = kx + b$ 的图像](https://example.com/line.png)',
  },
  {
    id: 'collected-n4',
    expectation: 'mixed',
    probes: '引用式链接定义与公式共存',
    src: `Refer to [勾股定理][pythagoras] and the constant $\\pi \\approx 3.14159$.

[pythagoras]: https://example.com/pythagoras`,
  },

  // ── O. HTML 与特殊字符 — < > & and tag-shaped fragments inside a formula ──
  {
    id: 'collected-o1',
    expectation: 'mixed',
    probes: '`<` `>` 不得触发 HTML 标签解析',
    src: 'For all $a < b$ and $c > d$, the inequality holds.',
  },
  {
    id: 'collected-o2',
    expectation: 'math',
    probes: '`<br>` 在公式内应被当作数学内容而非换行标签',
    src: 'The expression $x <br> y$ is not HTML.',
  },
  {
    id: 'collected-o3',
    expectation: 'mixed',
    probes: '`&` 不得被当作 HTML 实体起始',
    src: 'The set $A \\cap B$ and the entity $a \\& b$ coexist.',
  },
  {
    id: 'collected-o4',
    expectation: 'raw',
    probes: '注释内容整体不可见',
    src: `<!-- 内部备注：预算 $5,000，公式 $x^2$ 都不应渲染 -->

上一行是 HTML 注释，其内容不应出现在渲染结果中。`,
  },

  // ── P. 混合压力 — four forms at once, in one line / list / table / quote ──
  {
    id: 'collected-p1',
    expectation: 'mixed',
    probes: '货币、公式、转义美元符、行内代码依次出现在同一行',
    src: 'Price $100, formula $x^2$, escaped \\$50, and code `$lookup`.',
  },
  {
    id: 'collected-p2',
    expectation: 'mixed',
    probes: '同 P1，但外层是列表项与粗体',
    src: '- **成本**：$1,200；**公式**：$C = \\frac{V}{n}$；**转义**：\\$0；**代码**：`$sum`',
  },
  {
    id: 'collected-p3',
    expectation: 'mixed',
    probes: '表格 + 货币 + 公式 + 转义',
    src: `| 场景 | 内容 |
| --- | --- |
| 混合 | 单价 $50，公式 $p = \\frac{m}{V}$ |
| 转义 | \\$100 与 $\\ce{H2O}$ |`,
  },
  {
    id: 'collected-p4',
    expectation: 'mixed',
    probes: '引用块 + 货币 + 公式 + 行内代码',
    src: '> 预算为 $2,500，对应模型为 $y = ax + b$，参数写作 `$params`。',
  },
  {
    id: 'collected-p5',
    expectation: 'mixed',
    probes: '连续空行分隔，配对不得跨越空行',
    src: `金额 $300



公式 $z^2$`,
  },
];

/**
 * Cases that do NOT behave as annotated, kept deliberately.
 *
 * A corpus that quietly drops what its subject fails is a corpus that can
 * never report a fix. These stay, the gate knows about them by id, and the
 * gate fails if one of them starts passing — because that is a change worth
 * noticing, and the alternative is finding out months later.
 */
export const COLLECTED_KNOWN_GAPS: readonly string[] = ['collected-o2'];
