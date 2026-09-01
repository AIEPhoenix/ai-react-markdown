/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Re-derive with `pnpm --filter @bench/corpus generate:math`.
 * `pnpm --filter @bench/corpus validate` fails if this file and the
 * installed KaTeX have drifted apart.
 *
 * Derived from KaTeX 0.16.47's own tables and then filtered by
 * rendering every candidate with `throwOnError`. Coverage below is what
 * survived, not what was attempted; `excluded.json` carries the rest with
 * the error each one raised.
 *
 *   math symbols    468 of  490
 *   text symbols     67 of   67
 *   literal chars    42 of   52
 *   functions       254 of  273
 *   macros          275 of  297
 *   environments     33 of   33
 */

export const KATEX_VERSION = '0.16.47';

/** Every math-mode symbol KaTeX defines, grouped into inline formulas. */
export const MATH_SYMBOLS: readonly string[] = [
  `{\\equiv} \\quad {\\prec} \\quad {\\succ} \\quad {\\sim} \\quad {\\perp} \\quad {\\preceq} \\quad {\\succeq} \\quad {\\simeq} \\quad {\\mid} \\quad {\\ll} \\quad {\\gg} \\quad {\\asymp}`,
  `{\\parallel} \\quad {\\bowtie} \\quad {\\smile} \\quad {\\sqsubseteq} \\quad {\\sqsupseteq} \\quad {\\doteq} \\quad {\\frown} \\quad {\\ni} \\quad {\\propto} \\quad {\\vdash} \\quad {\\dashv} \\quad {\\owns}`,
  `{\\ldotp} \\quad {\\cdotp} \\quad {\\#} \\quad {\\&} \\quad {\\aleph} \\quad {\\forall} \\quad {\\hbar} \\quad {\\exists} \\quad {\\nabla} \\quad {\\flat} \\quad {\\ell} \\quad {\\natural}`,
  `{\\clubsuit} \\quad {\\wp} \\quad {\\sharp} \\quad {\\diamondsuit} \\quad {\\Re} \\quad {\\heartsuit} \\quad {\\Im} \\quad {\\spadesuit} \\quad {\\S} \\quad {\\P} \\quad {\\dag} \\quad {\\ddag}`,
  `{\\rmoustache} \\quad {\\lmoustache} \\quad {\\rgroup} \\quad {\\lgroup} \\quad {\\mp} \\quad {\\ominus} \\quad {\\uplus} \\quad {\\sqcap} \\quad {\\ast} \\quad {\\sqcup} \\quad {\\bigcirc} \\quad {\\bullet}`,
  `{\\ddagger} \\quad {\\wr} \\quad {\\amalg} \\quad {\\And} \\quad {\\longleftarrow} \\quad {\\Leftarrow} \\quad {\\Longleftarrow} \\quad {\\longrightarrow} \\quad {\\Rightarrow} \\quad {\\Longrightarrow} \\quad {\\leftrightarrow} \\quad {\\longleftrightarrow}`,
  `{\\Leftrightarrow} \\quad {\\Longleftrightarrow} \\quad {\\mapsto} \\quad {\\longmapsto} \\quad {\\nearrow} \\quad {\\hookleftarrow} \\quad {\\hookrightarrow} \\quad {\\searrow} \\quad {\\leftharpoonup} \\quad {\\rightharpoonup} \\quad {\\swarrow} \\quad {\\leftharpoondown}`,
  `{\\rightharpoondown} \\quad {\\nwarrow} \\quad {\\rightleftharpoons} \\quad {\\nless} \\quad {\\lneq} \\quad {\\lneqq} \\quad {\\lnsim} \\quad {\\lnapprox} \\quad {\\nprec} \\quad {\\npreceq} \\quad {\\precnsim} \\quad {\\precnapprox}`,
  `{\\nsim} \\quad {\\nmid} \\quad {\\nvdash} \\quad {\\nvDash} \\quad {\\ntriangleleft} \\quad {\\ntrianglelefteq} \\quad {\\subsetneq} \\quad {\\subsetneqq} \\quad {\\ngtr} \\quad {\\gneq} \\quad {\\gneqq} \\quad {\\gnsim}`,
  `{\\gnapprox} \\quad {\\nsucc} \\quad {\\nsucceq} \\quad {\\succnsim} \\quad {\\succnapprox} \\quad {\\ncong} \\quad {\\nparallel} \\quad {\\nVDash} \\quad {\\ntriangleright} \\quad {\\ntrianglerighteq} \\quad {\\supsetneq} \\quad {\\supsetneqq}`,
  `{\\nVdash} \\quad {\\precneqq} \\quad {\\succneqq} \\quad {\\unlhd} \\quad {\\unrhd} \\quad {\\nleftarrow} \\quad {\\nrightarrow} \\quad {\\nLeftarrow} \\quad {\\nRightarrow} \\quad {\\nleftrightarrow} \\quad {\\nLeftrightarrow} \\quad {\\vartriangle}`,
  `{\\hslash} \\quad {\\triangledown} \\quad {\\lozenge} \\quad {\\circledS} \\quad {\\circledR} \\quad {\\measuredangle} \\quad {\\nexists} \\quad {\\mho} \\quad {\\Finv} \\quad {\\Game} \\quad {\\backprime} \\quad {\\blacktriangle}`,
  `{\\blacktriangledown} \\quad {\\blacksquare} \\quad {\\blacklozenge} \\quad {\\bigstar} \\quad {\\sphericalangle} \\quad {\\complement} \\quad {\\eth} \\quad {\\diagup} \\quad {\\diagdown} \\quad {\\square} \\quad {\\Box} \\quad {\\Diamond}`,
  `{\\yen} \\quad {\\checkmark} \\quad {\\beth} \\quad {\\daleth} \\quad {\\gimel} \\quad {\\digamma} \\quad {\\varkappa} \\quad {\\leqq} \\quad {\\leqslant} \\quad {\\eqslantless} \\quad {\\lesssim} \\quad {\\lessapprox}`,
  `{\\approxeq} \\quad {\\lessdot} \\quad {\\lll} \\quad {\\lessgtr} \\quad {\\lesseqgtr} \\quad {\\lesseqqgtr} \\quad {\\doteqdot} \\quad {\\risingdotseq} \\quad {\\fallingdotseq} \\quad {\\backsim} \\quad {\\backsimeq} \\quad {\\subseteqq}`,
  `{\\Subset} \\quad {\\sqsubset} \\quad {\\preccurlyeq} \\quad {\\curlyeqprec} \\quad {\\precsim} \\quad {\\precapprox} \\quad {\\vartriangleleft} \\quad {\\trianglelefteq} \\quad {\\vDash} \\quad {\\Vvdash} \\quad {\\smallsmile} \\quad {\\smallfrown}`,
  `{\\bumpeq} \\quad {\\Bumpeq} \\quad {\\geqq} \\quad {\\geqslant} \\quad {\\eqslantgtr} \\quad {\\gtrsim} \\quad {\\gtrapprox} \\quad {\\gtrdot} \\quad {\\ggg} \\quad {\\gtrless} \\quad {\\gtreqless} \\quad {\\gtreqqless}`,
  `{\\eqcirc} \\quad {\\circeq} \\quad {\\triangleq} \\quad {\\thicksim} \\quad {\\thickapprox} \\quad {\\supseteqq} \\quad {\\Supset} \\quad {\\sqsupset} \\quad {\\succcurlyeq} \\quad {\\curlyeqsucc} \\quad {\\succsim} \\quad {\\succapprox}`,
  `{\\vartriangleright} \\quad {\\trianglerighteq} \\quad {\\Vdash} \\quad {\\shortmid} \\quad {\\shortparallel} \\quad {\\between} \\quad {\\pitchfork} \\quad {\\varpropto} \\quad {\\blacktriangleleft} \\quad {\\therefore} \\quad {\\backepsilon} \\quad {\\blacktriangleright}`,
  `{\\because} \\quad {\\llless} \\quad {\\gggtr} \\quad {\\lhd} \\quad {\\rhd} \\quad {\\eqsim} \\quad {\\Join} \\quad {\\Doteq} \\quad {\\dotplus} \\quad {\\smallsetminus} \\quad {\\Cap} \\quad {\\Cup}`,
  `{\\doublebarwedge} \\quad {\\boxminus} \\quad {\\boxplus} \\quad {\\divideontimes} \\quad {\\ltimes} \\quad {\\rtimes} \\quad {\\leftthreetimes} \\quad {\\rightthreetimes} \\quad {\\curlywedge} \\quad {\\curlyvee} \\quad {\\circleddash} \\quad {\\circledast}`,
  `{\\centerdot} \\quad {\\intercal} \\quad {\\doublecap} \\quad {\\doublecup} \\quad {\\boxtimes} \\quad {\\dashrightarrow} \\quad {\\dashleftarrow} \\quad {\\leftleftarrows} \\quad {\\leftrightarrows} \\quad {\\Lleftarrow} \\quad {\\twoheadleftarrow} \\quad {\\leftarrowtail}`,
  `{\\looparrowleft} \\quad {\\leftrightharpoons} \\quad {\\curvearrowleft} \\quad {\\circlearrowleft} \\quad {\\Lsh} \\quad {\\upuparrows} \\quad {\\upharpoonleft} \\quad {\\downharpoonleft} \\quad {\\origof} \\quad {\\imageof} \\quad {\\multimap} \\quad {\\leftrightsquigarrow}`,
  `{\\rightrightarrows} \\quad {\\rightleftarrows} \\quad {\\twoheadrightarrow} \\quad {\\rightarrowtail} \\quad {\\looparrowright} \\quad {\\curvearrowright} \\quad {\\circlearrowright} \\quad {\\Rsh} \\quad {\\downdownarrows} \\quad {\\upharpoonright} \\quad {\\downharpoonright} \\quad {\\rightsquigarrow}`,
  `{\\leadsto} \\quad {\\Rrightarrow} \\quad {\\restriction} \\quad {\\$} \\quad {\\%} \\quad {\\_} \\quad {\\angle} \\quad {\\infty} \\quad {\\prime} \\quad {\\triangle} \\quad {\\Gamma} \\quad {\\Delta}`,
  `{\\Theta} \\quad {\\Lambda} \\quad {\\Xi} \\quad {\\Pi} \\quad {\\Sigma} \\quad {\\Upsilon} \\quad {\\Phi} \\quad {\\Psi} \\quad {\\Omega} \\quad {\\neg} \\quad {\\lnot} \\quad {\\top}`,
  `{\\bot} \\quad {\\emptyset} \\quad {\\varnothing} \\quad {\\alpha} \\quad {\\beta} \\quad {\\gamma} \\quad {\\delta} \\quad {\\epsilon} \\quad {\\zeta} \\quad {\\eta} \\quad {\\theta} \\quad {\\iota}`,
  `{\\kappa} \\quad {\\lambda} \\quad {\\mu} \\quad {\\nu} \\quad {\\xi} \\quad {\\omicron} \\quad {\\pi} \\quad {\\rho} \\quad {\\sigma} \\quad {\\tau} \\quad {\\upsilon} \\quad {\\phi}`,
  `{\\chi} \\quad {\\psi} \\quad {\\omega} \\quad {\\varepsilon} \\quad {\\vartheta} \\quad {\\varpi} \\quad {\\varrho} \\quad {\\varsigma} \\quad {\\varphi} \\quad {\\cdot} \\quad {\\circ} \\quad {\\div}`,
  `{\\pm} \\quad {\\times} \\quad {\\cap} \\quad {\\cup} \\quad {\\setminus} \\quad {\\land} \\quad {\\lor} \\quad {\\wedge} \\quad {\\vee} \\quad {\\surd} \\quad {\\langle} \\quad {\\lvert}`,
  `{\\lVert} \\quad {\\rangle} \\quad {\\rvert} \\quad {\\rVert} \\quad {\\approx} \\quad {\\cong} \\quad {\\ge} \\quad {\\geq} \\quad {\\gets} \\quad {\\gt} \\quad {\\in} \\quad {\\subset}`,
  `{\\supset} \\quad {\\subseteq} \\quad {\\supseteq} \\quad {\\nsubseteq} \\quad {\\nsupseteq} \\quad {\\models} \\quad {\\leftarrow} \\quad {\\le} \\quad {\\leq} \\quad {\\lt} \\quad {\\rightarrow} \\quad {\\to}`,
  `{\\ngeq} \\quad {\\nleq} \\quad {\\ } \\quad {\\space} \\quad {\\nobreakspace} \\quad {\\nobreak} \\quad {\\allowbreak} \\quad {\\barwedge} \\quad {\\veebar} \\quad {\\odot} \\quad {\\oplus} \\quad {\\otimes}`,
  `{\\partial} \\quad {\\oslash} \\quad {\\circledcirc} \\quad {\\boxdot} \\quad {\\bigtriangleup} \\quad {\\bigtriangledown} \\quad {\\dagger} \\quad {\\diamond} \\quad {\\star} \\quad {\\triangleleft} \\quad {\\triangleright} \\quad {\\{}`,
  `{\\}} \\quad {\\lbrace} \\quad {\\rbrace} \\quad {\\lbrack} \\quad {\\rbrack} \\quad {\\lparen} \\quad {\\rparen} \\quad {\\lfloor} \\quad {\\rfloor} \\quad {\\lceil} \\quad {\\rceil} \\quad {\\backslash}`,
  `{\\vert} \\quad {\\|} \\quad {\\Vert} \\quad {\\uparrow} \\quad {\\Uparrow} \\quad {\\downarrow} \\quad {\\Downarrow} \\quad {\\updownarrow} \\quad {\\Updownarrow} \\quad {\\coprod} \\quad {\\bigvee} \\quad {\\bigwedge}`,
  `{\\biguplus} \\quad {\\bigcap} \\quad {\\bigcup} \\quad {\\int} \\quad {\\intop} \\quad {\\iint} \\quad {\\iiint} \\quad {\\prod} \\quad {\\sum} \\quad {\\bigotimes} \\quad {\\bigoplus} \\quad {\\bigodot}`,
  `{\\oint} \\quad {\\oiint} \\quad {\\oiiint} \\quad {\\bigsqcup} \\quad {\\smallint} \\quad {\\mathellipsis} \\quad {\\ldots} \\quad {\\ddots} \\quad {\\varvdots} \\quad {\\acute{x}} \\quad {\\grave{x}} \\quad {\\ddot{x}}`,
  `{\\tilde{x}} \\quad {\\bar{x}} \\quad {\\breve{x}} \\quad {\\check{x}} \\quad {\\hat{x}} \\quad {\\vec{x}} \\quad {\\dot{x}} \\quad {\\mathring{x}} \\quad {\\degree} \\quad {\\pounds} \\quad {\\mathsterling} \\quad {\\maltese}`,
];

/** Every literal CHARACTER the symbol table accepts as input — capital
 *  Greek and the like, which have no command form. Separated from the
 *  commands because dressing one up as a command produced a fragment that
 *  rendered and meant something else. */
export const LITERAL_CHARS: readonly string[] = [
  `{·} \\quad {\\text{ð}} \\quad {\`} \\quad {Α} \\quad {Β} \\quad {Ε} \\quad {Ζ} \\quad {Η} \\quad {Ι} \\quad {Κ} \\quad {Μ} \\quad {Ν}`,
  `{Ο} \\quad {Ρ} \\quad {Τ} \\quad {Χ} \\quad {*} \\quad {+} \\quad {-} \\quad {?} \\quad {!} \\quad {=} \\quad {:} \\quad {\\text{ }}`,
  `{,} \\quad {;} \\quad {|} \\quad {ı} \\quad {ȷ} \\quad {\\text{--}} \\quad {\\text{---}} \\quad {\\text{'}} \\quad {\\text{\`\`}} \\quad {\\text{''}} \\quad {ℂ} \\quad {ℍ}`,
  `{ℕ} \\quad {ℙ} \\quad {ℚ} \\quad {ℝ} \\quad {ℤ} \\quad {ℎ}`,
];

/** Every text-mode symbol, each already wrapped in \text{}. */
export const TEXT_SYMBOLS: readonly string[] = [
  `{\\text{\\#}} \\quad {\\text{\\&}} \\quad {\\text{\\S}} \\quad {\\text{\\P}} \\quad {\\text{\\dag}} \\quad {\\text{\\textdagger}} \\quad {\\text{\\ddag}} \\quad {\\text{\\textdaggerdbl}} \\quad {\\text{\\circledR}} \\quad {\\text{\\yen}} \\quad {\\text{\\checkmark}} \\quad {\\text{\\$}}`,
  `{\\text{\\textdollar}} \\quad {\\text{\\%}} \\quad {\\text{\\_}} \\quad {\\text{\\textunderscore}} \\quad {\\text{\\ }} \\quad {\\text{\\space}} \\quad {\\text{\\nobreakspace}} \\quad {\\text{\\{}} \\quad {\\text{\\textbraceleft}} \\quad {\\text{\\}}} \\quad {\\text{\\textbraceright}} \\quad {\\text{\\lbrack}}`,
  `{\\text{\\rbrack}} \\quad {\\text{\\textless}} \\quad {\\text{\\textgreater}} \\quad {\\text{\\textbar}} \\quad {\\text{\\textbardbl}} \\quad {\\text{\\textasciitilde}} \\quad {\\text{\\textbackslash}} \\quad {\\text{\\textasciicircum}} \\quad {\\text{\\textellipsis}} \\quad {\\text{\\ldots}} \\quad {\\text{\\varvdots}} \\quad {\\text{\\i}}`,
  `{\\text{\\j}} \\quad {\\text{\\ss}} \\quad {\\text{\\ae}} \\quad {\\text{\\oe}} \\quad {\\text{\\o}} \\quad {\\text{\\AE}} \\quad {\\text{\\OE}} \\quad {\\text{\\O}} \\quad {\\text{\\'{x}}} \\quad {\\text{\\\`{x}}} \\quad {\\text{\\^{x}}} \\quad {\\text{\\~{x}}}`,
  `{\\text{\\={x}}} \\quad {\\text{\\u{x}}} \\quad {\\text{\\.{x}}} \\quad {\\text{\\c{x}}} \\quad {\\text{\\r{x}}} \\quad {\\text{\\v{x}}} \\quad {\\text{\\H{x}}} \\quad {\\text{\\textcircled{x}}} \\quad {\\text{\\textendash}} \\quad {\\text{\\textemdash}} \\quad {\\text{\\textquoteleft}} \\quad {\\text{\\textquoteright}}`,
  `{\\text{\\textquotedblleft}} \\quad {\\text{\\textquotedblright}} \\quad {\\text{\\degree}} \\quad {\\text{\\textdegree}} \\quad {\\text{\\pounds}} \\quad {\\text{\\textsterling}} \\quad {\\text{\\maltese}}`,
];

/** Every callable function name, applied to placeholder arguments. */
export const MATH_FUNCTIONS: readonly string[] = [
  `{\\\\cdleft{x}} \\quad {\\\\cdright{x}} \\quad {\\\\cdparent{x}} \\quad {\\acute{x}} \\quad {\\grave{x}} \\quad {\\ddot{x}} \\quad {\\tilde{x}} \\quad {\\bar{x}}`,
  `{\\breve{x}} \\quad {\\check{x}} \\quad {\\hat{x}} \\quad {\\vec{x}} \\quad {\\dot{x}} \\quad {\\mathring{x}} \\quad {\\widecheck{x}} \\quad {\\widehat{x}}`,
  `{\\widetilde{x}} \\quad {\\overrightarrow{x}} \\quad {\\overleftarrow{x}} \\quad {\\Overrightarrow{x}} \\quad {\\overleftrightarrow{x}} \\quad {\\overgroup{x}} \\quad {\\overlinesegment{x}} \\quad {\\overleftharpoon{x}}`,
  `{\\overrightharpoon{x}} \\quad {\\'{x}} \\quad {\\\`{x}} \\quad {\\^{x}} \\quad {\\~{x}} \\quad {\\={x}} \\quad {\\u{x}} \\quad {\\.{x}}`,
  `{\\underleftarrow{x}} \\quad {\\underrightarrow{x}} \\quad {\\underleftrightarrow{x}} \\quad {\\undergroup{x}} \\quad {\\underlinesegment{x}} \\quad {\\utilde{x}} \\quad {\\xleftarrow{x}} \\quad {\\xrightarrow{x}}`,
  `{\\xLeftarrow{x}} \\quad {\\xRightarrow{x}} \\quad {\\xleftrightarrow{x}} \\quad {\\xLeftrightarrow{x}} \\quad {\\xhookleftarrow{x}} \\quad {\\xhookrightarrow{x}} \\quad {\\xmapsto{x}} \\quad {\\xrightharpoondown{x}}`,
  `{\\xrightharpoonup{x}} \\quad {\\xleftharpoondown{x}} \\quad {\\xleftharpoonup{x}} \\quad {\\xrightleftharpoons{x}} \\quad {\\xleftrightharpoons{x}} \\quad {\\xlongequal{x}} \\quad {\\xtwoheadrightarrow{x}} \\quad {\\xtwoheadleftarrow{x}}`,
  `{\\xtofrom{x}} \\quad {\\xrightleftarrows{x}} \\quad {\\xrightequilibrium{x}} \\quad {\\xleftequilibrium{x}} \\quad {\\\\cdrightarrow{x}} \\quad {\\\\cdleftarrow{x}} \\quad {\\\\cdlongequal{x}} \\quad {\\textcolor{x}{x}}`,
  `{\\color{x}} \\quad {\\\\} \\quad {\\\\globallong} \\quad {\\\\globallet} \\quad {\\\\globalfuture} \\quad {\\bigl(} \\quad {\\Bigl(} \\quad {\\biggl(}`,
  `{\\Biggl(} \\quad {\\bigr(} \\quad {\\Bigr(} \\quad {\\biggr(} \\quad {\\Biggr(} \\quad {\\bigm(} \\quad {\\Bigm(} \\quad {\\biggm(}`,
  `{\\Biggm(} \\quad {\\big(} \\quad {\\Big(} \\quad {\\bigg(} \\quad {\\Bigg(} \\quad {\\left( x \\right)} \\quad {\\left( x \\right)} \\quad {\\left( x \\middle| x \\right)}`,
  `{\\colorbox{x}{x}} \\quad {\\fcolorbox{x}{x}{x}} \\quad {\\fbox{x}} \\quad {\\cancel{x}} \\quad {\\bcancel{x}} \\quad {\\xcancel{x}} \\quad {\\phase{x}} \\quad {\\sout{x}}`,
  `{\\angl{x}} \\quad {\\mathrm{x}} \\quad {\\mathit{x}} \\quad {\\mathbf{x}} \\quad {\\mathnormal{x}} \\quad {\\mathsfit{x}} \\quad {\\mathbb{x}} \\quad {\\mathcal{x}}`,
  `{\\mathfrak{x}} \\quad {\\mathscr{x}} \\quad {\\mathsf{x}} \\quad {\\mathtt{x}} \\quad {\\Bbb{x}} \\quad {\\bold{x}} \\quad {\\frak{x}} \\quad {\\boldsymbol{x}}`,
  `{\\bm{x}} \\quad {\\rm} \\quad {\\sf} \\quad {\\tt} \\quad {\\bf} \\quad {\\it} \\quad {\\cal} \\quad {\\cfrac{x}{x}}`,
  `{\\dfrac{x}{x}} \\quad {\\frac{x}{x}} \\quad {\\tfrac{x}{x}} \\quad {\\dbinom{x}{x}} \\quad {\\binom{x}{x}} \\quad {\\tbinom{x}{x}} \\quad {\\\\atopfrac{x}{x}} \\quad {\\\\bracefrac{x}{x}}`,
  `{\\\\brackfrac{x}{x}} \\quad {x \\over x} \\quad {x \\choose x} \\quad {x \\atop x} \\quad {x \\brace x} \\quad {x \\brack x} \\quad {\\genfrac{(}{)}{0pt}{0}{x}{x}} \\quad {x \\above 1pt x}`,
  `{\\\\abovefrac{x}{x}{x}} \\quad {\\hbox{x}} \\quad {\\overbrace{x}} \\quad {\\underbrace{x}} \\quad {\\overbracket{x}} \\quad {\\underbracket{x}} \\quad {\\href{x}{x}} \\quad {\\url{x}}`,
  `{\\htmlClass{x}{x}} \\quad {\\htmlId{x}{x}} \\quad {\\htmlStyle{x}{x}} \\quad {\\htmlData{a=b}{x}} \\quad {\\includegraphics[height=1em]{x.png}} \\quad {\\kern 1em} \\quad {\\mkern 1mu} \\quad {\\hskip 1em}`,
  `{\\mskip 1mu} \\quad {\\mathllap{x}} \\quad {\\mathrlap{x}} \\quad {\\mathclap{x}} \\quad {\\mathchoice{x}{x}{x}{x}} \\quad {\\mathord{x}} \\quad {\\mathbin{x}} \\quad {\\mathrel{x}}`,
  `{\\mathopen{x}} \\quad {\\mathclose{x}} \\quad {\\mathpunct{x}} \\quad {\\mathinner{x}} \\quad {\\stackrel{x}{x}} \\quad {\\overset{x}{x}} \\quad {\\underset{x}{x}} \\quad {\\coprod}`,
  `{\\bigvee} \\quad {\\bigwedge} \\quad {\\biguplus} \\quad {\\bigcap} \\quad {\\bigcup} \\quad {\\intop} \\quad {\\prod} \\quad {\\sum}`,
  `{\\bigotimes} \\quad {\\bigoplus} \\quad {\\bigodot} \\quad {\\bigsqcup} \\quad {\\smallint} \\quad {\\mathop{x}} \\quad {\\arcsin} \\quad {\\arccos}`,
  `{\\arctan} \\quad {\\arctg} \\quad {\\arcctg} \\quad {\\arg} \\quad {\\ch} \\quad {\\cos} \\quad {\\cosec} \\quad {\\cosh}`,
  `{\\cot} \\quad {\\cotg} \\quad {\\coth} \\quad {\\csc} \\quad {\\ctg} \\quad {\\cth} \\quad {\\deg} \\quad {\\dim}`,
  `{\\exp} \\quad {\\hom} \\quad {\\ker} \\quad {\\lg} \\quad {\\ln} \\quad {\\log} \\quad {\\sec} \\quad {\\sin}`,
  `{\\sinh} \\quad {\\sh} \\quad {\\tan} \\quad {\\tanh} \\quad {\\tg} \\quad {\\th} \\quad {\\det} \\quad {\\gcd}`,
  `{\\inf} \\quad {\\lim} \\quad {\\max} \\quad {\\min} \\quad {\\Pr} \\quad {\\sup} \\quad {\\int} \\quad {\\iint}`,
  `{\\iiint} \\quad {\\oint} \\quad {\\oiint} \\quad {\\oiiint} \\quad {\\operatornamewithlimits{x}} \\quad {\\overline{x}} \\quad {\\phantom{x}} \\quad {\\vphantom{x}}`,
  `{\\pmb{x}} \\quad {\\raisebox{1em}{x}} \\quad {\\rule{1em}{1em}} \\quad {\\smash{x}} \\quad {\\sqrt{x}} \\quad {\\displaystyle} \\quad {\\textstyle} \\quad {\\scriptstyle}`,
  `{\\scriptscriptstyle} \\quad {\\text{x}} \\quad {\\textrm{x}} \\quad {\\textsf{x}} \\quad {\\texttt{x}} \\quad {\\textnormal{x}} \\quad {\\textbf{x}} \\quad {\\textmd{x}}`,
  `{\\textit{x}} \\quad {\\textup{x}} \\quad {\\emph{x}} \\quad {\\underline{x}} \\quad {\\vcenter{x}} \\quad {\\verb|x|}`,
];

/** Every macro that renders standalone. */
export const MATH_MACROS: readonly string[] = [
  `{\\nonumber} \\quad {\\notag} \\quad {\\operatorname{x}} \\quad {\\hphantom{x}} \\quad {\\TextOrMath{x}{x}} \\quad {\\char"41} \\quad {\\lq} \\quad {\\rq} \\quad {\\aa} \\quad {\\AA}`,
  `{\\textcopyright} \\quad {\\copyright} \\quad {\\textregistered} \\quad {\\Bbbk} \\quad {\\llap{x}} \\quad {\\rlap{x}} \\quad {\\clap{x}} \\quad {\\mathstrut} \\quad {\\underbar{x}} \\quad {\\not}`,
  `{\\neq} \\quad {\\ne} \\quad {\\notin} \\quad {\\ulcorner} \\quad {\\urcorner} \\quad {\\llcorner} \\quad {\\lrcorner} \\quad {\\vdots} \\quad {\\varGamma} \\quad {\\varDelta}`,
  `{\\varTheta} \\quad {\\varLambda} \\quad {\\varXi} \\quad {\\varPi} \\quad {\\varSigma} \\quad {\\varUpsilon} \\quad {\\varPhi} \\quad {\\varPsi} \\quad {\\varOmega} \\quad {\\substack{x}}`,
  `{\\colon} \\quad {\\boxed{x}} \\quad {\\iff} \\quad {\\implies} \\quad {\\impliedby} \\quad {\\dddot{x}} \\quad {\\ddddot{x}} \\quad {\\dots} \\quad {\\dotso} \\quad {\\dotsc}`,
  `{\\cdots} \\quad {\\dotsb} \\quad {\\dotsm} \\quad {\\dotsi} \\quad {\\dotsx} \\quad {\\DOTSI} \\quad {\\DOTSB} \\quad {\\DOTSX} \\quad {\\,} \\quad {\\thinspace}`,
  `{\\>} \\quad {\\:} \\quad {\\medspace} \\quad {\\;} \\quad {\\thickspace} \\quad {\\!} \\quad {\\negthinspace} \\quad {\\negmedspace} \\quad {\\negthickspace} \\quad {\\enspace}`,
  `{\\enskip} \\quad {\\quad} \\quad {\\qquad} \\quad {\\bmod} \\quad {\\pod{x}} \\quad {\\pmod{x}} \\quad {\\mod{x}} \\quad {\\newline} \\quad {\\TeX} \\quad {\\LaTeX}`,
  `{\\KaTeX} \\quad {\\hspace{1em}} \\quad {\\ordinarycolon} \\quad {\\vcentcolon} \\quad {\\dblcolon} \\quad {\\coloneqq} \\quad {\\Coloneqq} \\quad {\\coloneq} \\quad {\\Coloneq} \\quad {\\eqqcolon}`,
  `{\\Eqqcolon} \\quad {\\eqcolon} \\quad {\\Eqcolon} \\quad {\\colonapprox} \\quad {\\Colonapprox} \\quad {\\colonsim} \\quad {\\Colonsim} \\quad {\\ratio} \\quad {\\coloncolon} \\quad {\\colonequals}`,
  `{\\coloncolonequals} \\quad {\\equalscolon} \\quad {\\equalscoloncolon} \\quad {\\colonminus} \\quad {\\coloncolonminus} \\quad {\\minuscolon} \\quad {\\minuscoloncolon} \\quad {\\coloncolonapprox} \\quad {\\coloncolonsim} \\quad {\\simcolon}`,
  `{\\simcoloncolon} \\quad {\\approxcolon} \\quad {\\approxcoloncolon} \\quad {\\notni} \\quad {\\limsup} \\quad {\\liminf} \\quad {\\injlim} \\quad {\\projlim} \\quad {\\varlimsup} \\quad {\\varliminf}`,
  `{\\varinjlim} \\quad {\\varprojlim} \\quad {\\gvertneqq} \\quad {\\lvertneqq} \\quad {\\ngeqq} \\quad {\\ngeqslant} \\quad {\\nleqq} \\quad {\\nleqslant} \\quad {\\nshortmid} \\quad {\\nshortparallel}`,
  `{\\nsubseteqq} \\quad {\\nsupseteqq} \\quad {\\varsubsetneq} \\quad {\\varsubsetneqq} \\quad {\\varsupsetneq} \\quad {\\varsupsetneqq} \\quad {\\imath} \\quad {\\jmath} \\quad {\\llbracket} \\quad {\\rrbracket}`,
  `{\\lBrace} \\quad {\\rBrace} \\quad {\\minuso} \\quad {\\darr} \\quad {\\dArr} \\quad {\\Darr} \\quad {\\lang} \\quad {\\rang} \\quad {\\uarr} \\quad {\\uArr}`,
  `{\\Uarr} \\quad {\\N} \\quad {\\R} \\quad {\\Z} \\quad {\\alef} \\quad {\\alefsym} \\quad {\\Alpha} \\quad {\\Beta} \\quad {\\bull} \\quad {\\Chi}`,
  `{\\clubs} \\quad {\\cnums} \\quad {\\Complex} \\quad {\\Dagger} \\quad {\\diamonds} \\quad {\\empty} \\quad {\\Epsilon} \\quad {\\Eta} \\quad {\\exist} \\quad {\\harr}`,
  `{\\hArr} \\quad {\\Harr} \\quad {\\hearts} \\quad {\\image} \\quad {\\infin} \\quad {\\Iota} \\quad {\\isin} \\quad {\\Kappa} \\quad {\\larr} \\quad {\\lArr}`,
  `{\\Larr} \\quad {\\lrarr} \\quad {\\lrArr} \\quad {\\Lrarr} \\quad {\\Mu} \\quad {\\natnums} \\quad {\\Nu} \\quad {\\Omicron} \\quad {\\plusmn} \\quad {\\rarr}`,
  `{\\rArr} \\quad {\\Rarr} \\quad {\\real} \\quad {\\reals} \\quad {\\Reals} \\quad {\\Rho} \\quad {\\sdot} \\quad {\\sect} \\quad {\\spades} \\quad {\\sub}`,
  `{\\sube} \\quad {\\supe} \\quad {\\Tau} \\quad {\\thetasym} \\quad {\\weierp} \\quad {\\Zeta} \\quad {\\argmin} \\quad {\\argmax} \\quad {\\plim} \\quad {\\bra{x}}`,
  `{\\ket{x}} \\quad {\\braket{x}} \\quad {\\Bra{x}} \\quad {\\Ket{x}} \\quad {\\Braket{x}} \\quad {\\Set{x}} \\quad {\\set{x}} \\quad {\\angln} \\quad {\\blue{x}} \\quad {\\orange{x}}`,
  `{\\pink{x}} \\quad {\\red{x}} \\quad {\\green{x}} \\quad {\\gray{x}} \\quad {\\purple{x}} \\quad {\\blueA{x}} \\quad {\\blueB{x}} \\quad {\\blueC{x}} \\quad {\\blueD{x}} \\quad {\\blueE{x}}`,
  `{\\tealA{x}} \\quad {\\tealB{x}} \\quad {\\tealC{x}} \\quad {\\tealD{x}} \\quad {\\tealE{x}} \\quad {\\greenA{x}} \\quad {\\greenB{x}} \\quad {\\greenC{x}} \\quad {\\greenD{x}} \\quad {\\greenE{x}}`,
  `{\\goldA{x}} \\quad {\\goldB{x}} \\quad {\\goldC{x}} \\quad {\\goldD{x}} \\quad {\\goldE{x}} \\quad {\\redA{x}} \\quad {\\redB{x}} \\quad {\\redC{x}} \\quad {\\redD{x}} \\quad {\\redE{x}}`,
  `{\\maroonA{x}} \\quad {\\maroonB{x}} \\quad {\\maroonC{x}} \\quad {\\maroonD{x}} \\quad {\\maroonE{x}} \\quad {\\purpleA{x}} \\quad {\\purpleB{x}} \\quad {\\purpleC{x}} \\quad {\\purpleD{x}} \\quad {\\purpleE{x}}`,
  `{\\mintA{x}} \\quad {\\mintB{x}} \\quad {\\mintC{x}} \\quad {\\grayA{x}} \\quad {\\grayB{x}} \\quad {\\grayC{x}} \\quad {\\grayD{x}} \\quad {\\grayE{x}} \\quad {\\grayF{x}} \\quad {\\grayG{x}}`,
  `{\\grayH{x}} \\quad {\\grayI{x}} \\quad {\\kaBlue{x}} \\quad {\\kaGreen{x}}`,
];

/** Every environment, with a body shaped to fit it. One per entry — these are
 *  display-level constructs and packing them would change what is measured. */
export const MATH_ENVIRONMENTS: readonly string[] = [
  `\\begin{array}{cc}x & x \\\\ x & x\\end{array}`,
  `\\begin{darray}{cc}x & x \\\\ x & x\\end{darray}`,
  `\\begin{matrix}x & x \\\\ x & x\\end{matrix}`,
  `\\begin{pmatrix}x & x \\\\ x & x\\end{pmatrix}`,
  `\\begin{bmatrix}x & x \\\\ x & x\\end{bmatrix}`,
  `\\begin{Bmatrix}x & x \\\\ x & x\\end{Bmatrix}`,
  `\\begin{vmatrix}x & x \\\\ x & x\\end{vmatrix}`,
  `\\begin{Vmatrix}x & x \\\\ x & x\\end{Vmatrix}`,
  `\\begin{matrix*}x & x \\\\ x & x\\end{matrix*}`,
  `\\begin{pmatrix*}x & x \\\\ x & x\\end{pmatrix*}`,
  `\\begin{bmatrix*}x & x \\\\ x & x\\end{bmatrix*}`,
  `\\begin{Bmatrix*}x & x \\\\ x & x\\end{Bmatrix*}`,
  `\\begin{vmatrix*}x & x \\\\ x & x\\end{vmatrix*}`,
  `\\begin{Vmatrix*}x & x \\\\ x & x\\end{Vmatrix*}`,
  `\\begin{smallmatrix}x & x \\\\ x & x\\end{smallmatrix}`,
  `\\begin{subarray}{c}x \\\\ x\\end{subarray}`,
  `\\begin{cases}x & x \\\\ x & x\\end{cases}`,
  `\\begin{dcases}x & x \\\\ x & x\\end{dcases}`,
  `\\begin{rcases}x & x \\\\ x & x\\end{rcases}`,
  `\\begin{drcases}x & x \\\\ x & x\\end{drcases}`,
  `\\begin{aligned}x & x \\\\ x & x\\end{aligned}`,
  `\\begin{gathered}x & x \\\\ x & x\\end{gathered}`,
  `\\begin{alignedat}{2}x & x \\\\ x & x\\end{alignedat}`,
];

/** Fragments that KaTeX accepts ONLY in display mode — `align`, `gather`,
 *  `equation`, `split`, `alignat`, `CD` and anything else the generator
 *  found to behave that way. Consumers must wrap these in `$$`; putting one
 *  between single dollars throws, which is why they are a separate export
 *  rather than mixed into the lists above. */
export const DISPLAY_ONLY: readonly string[] = [
  `\\tag{x}`,
  `\\begin{align}x & x \\\\ x & x\\end{align}`,
  `\\begin{align*}x & x \\\\ x & x\\end{align*}`,
  `\\begin{split}x & x \\\\ x & x\\end{split}`,
  `\\begin{gather}x & x \\\\ x & x\\end{gather}`,
  `\\begin{gather*}x & x \\\\ x & x\\end{gather*}`,
  `\\begin{alignat}{2}x & x \\\\ x & x\\end{alignat}`,
  `\\begin{alignat*}{2}x & x \\\\ x & x\\end{alignat*}`,
  `\\begin{equation}x \\\\ x\\end{equation}`,
  `\\begin{equation*}x \\\\ x\\end{equation*}`,
  `\\begin{CD}x & x \\\\ x & x\\end{CD}`,
];

/** Total distinct KaTeX identifiers exercised by the four lists above. */
export const GENERATED_IDENTIFIER_COUNT = 1139;
