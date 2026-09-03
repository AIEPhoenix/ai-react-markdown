/**
 * The soft-atom model of `processSlice`: tags are masked atoms inside a
 * run, code is a hard boundary, same-line paired tags are scopes. Exact
 * bytes, per line ending. The legacy arm (`{ legacy: true }`) is today's
 * per-segment behaviour and is compared in `latexSoftAtoms.differential`.
 */
import { describe, expect, test, afterEach } from 'vitest';
import {
  preprocessLaTeX,
  processSlice,
  selectMask,
  splitByProtectedRegions,
  __setRestoreFailureInjector,
} from './latex';
import { LINE_ENDINGS, expandShape } from './latexSoftAtomFixtures';

afterEach(() => __setRestoreFailureInjector(null));

const eachEol = (fn: (eol: string, name: string) => void): void => {
  for (const [name, eol] of LINE_ENDINGS) fn(eol, name);
};

describe('soft atoms — the defect', () => {
  test('a tag inside inline math no longer splits the formula', () => {
    expect(preprocessLaTeX('$x <br> y$')).toBe('$$x <br> y$$');
  });

  test('a tag inside a closed display block no longer deletes its head', () => {
    expect(preprocessLaTeX('$$ a <br> b $$')).toBe('$$ a <br> b $$');
  });

  test('a paired tag inside a table-cell formula no longer rewrites the trailing pipe', () => {
    expect(preprocessLaTeX('| $a <b>x</b> b$ |')).toBe('| $$a <b>x</b> b$$ |');
  });

  test('a multi-line display block with a tag keeps its head and tail (all line endings)', () => {
    eachEol((eol) => {
      const a = expandShape('$${eol}a <br>{eol}b{eol}$$', eol);
      expect(preprocessLaTeX(a)).toBe(a);
      const b = expandShape('$${eol}a{eol}<br>{eol}b{eol}$$', eol);
      expect(preprocessLaTeX(b)).toBe(b);
    });
  });

  test('streaming: an unclosed block is truncated whole — the tag no longer leaks past the cut', () => {
    eachEol((eol) => {
      expect(preprocessLaTeX(expandShape('$${eol}a <br> b', eol))).toBe('');
      expect(preprocessLaTeX(expandShape('$${eol}a <b>x</b> b', eol))).toBe('');
    });
  });
});

describe('soft atoms — the idiom and attributes are untouched', () => {
  test('<span>$</span> isolates a literal dollar', () => {
    expect(preprocessLaTeX('To split <span>$</span>100 in half, we calculate $100/2$')).toBe(
      'To split <span>$</span>100 in half, we calculate $$100/2$$'
    );
    expect(preprocessLaTeX('Price is <span>$</span>100 and formula $x^2$')).toBe(
      'Price is <span>$</span>100 and formula $$x^2$$'
    );
    expect(preprocessLaTeX('<span>$</span>50 is half of <span>$</span>100')).toBe(
      '<span>$</span>50 is half of <span>$</span>100'
    );
  });

  test('attribute values are never rewritten', () => {
    expect(preprocessLaTeX('$x$ <a href="a|b">x</a>')).toBe('$$x$$ <a href="a|b">x</a>');
    expect(preprocessLaTeX('$x$ <a title="\\[x\\]">x</a>')).toBe('$$x$$ <a title="\\[x\\]">x</a>');
  });
});

describe('soft atoms — scopes pair top-of-stack only', () => {
  test('exact bytes for the three crossing shapes and a lone closer', () => {
    expect(preprocessLaTeX('<b><i>$x$</i></b>')).toBe('<b><i>$$x$$</i></b>');
    expect(preprocessLaTeX('<b><i>$x$</b></i>')).toBe('<b><i>$$x$$</b></i>');
    expect(preprocessLaTeX('<b><i></b>$x$</i>')).toBe('<b><i></b>$$x$$</i>');
    expect(preprocessLaTeX('x</b>y $a$')).toBe('x</b>y $$a$$');
    expect(preprocessLaTeX('<b>a<br>b</b> $a$')).toBe('<b>a<br>b</b> $$a$$');
  });

  test("a scope's inner text is its own run: a lone $ inside cannot pair outward", () => {
    expect(preprocessLaTeX('<b>$</b>100 and $x$')).toBe('<b>$</b>100 and $$x$$');
  });

  test('a mid-line $$ inside a scope does not open a math flow', () => {
    expect(preprocessLaTeX('<b>$$ x</b> $y$')).toBe('<b>$$ x</b> $$y$$');
  });

  test('nine nested same-name levels: every closer is consumed by its own opener, the ninth is suppressed', () => {
    const open = '<b>'.repeat(9);
    const close = '</b>'.repeat(9);
    expect(preprocessLaTeX(`${open}$x$${close}`)).toBe(`${open}$$x$$${close}`);
    // The ninth level is atoms, not a scope: a lone `$` inside it CAN pair
    // with one outside the ninth pair (but still inside the eighth scope).
    expect(preprocessLaTeX(`${open}$${close.slice(0, 5)} y $${close.slice(5)}`)).toBe(
      `${open}$$${close.slice(0, 5)} y $$${close.slice(5)}`
    );
  });

  test('nine distinct nested names', () => {
    const names = ['b', 'i', 'u', 's', 'em', 'strong', 'small', 'mark', 'del'];
    const open = names.map((n) => `<${n}>`).join('');
    const close = [...names]
      .reverse()
      .map((n) => `</${n}>`)
      .join('');
    expect(preprocessLaTeX(`${open}$x$${close}`)).toBe(`${open}$$x$$${close}`);
  });

  test('scopes do not cross lines: an opener left open at end of line is an atom', () => {
    eachEol((eol) => {
      expect(preprocessLaTeX(expandShape('<b>$a${eol}b</b> $c$', eol))).toBe(
        expandShape('<b>$$a$${eol}b</b> $$c$$', eol)
      );
    });
  });

  test('a scope cannot span a hard boundary', () => {
    expect(preprocessLaTeX('<b>a `c` b</b> $x$')).toBe('<b>a `c` b</b> $$x$$');
    expect(splitByProtectedRegions('<b>a `c` b</b>').map((s) => s.kind)).toEqual([
      'tag',
      'text',
      'code',
      'text',
      'tag',
    ]);
  });
});

describe('soft atoms — line origin is a virtual predecessor', () => {
  test('the four contrasts, per line ending', () => {
    eachEol((eol) => {
      expect(preprocessLaTeX('`c`$$ x')).toBe('`c`$$ x');
      expect(preprocessLaTeX(expandShape('`c`{eol}{eol}$$ x', eol))).toBe('`c`');
      expect(preprocessLaTeX('<br>$$ x')).toBe('<br>$$ x');
      expect(preprocessLaTeX(expandShape('<br>{eol}$$ x', eol))).toBe('<br>');
      expect(preprocessLaTeX('a <br>$$ x')).toBe('a <br>$$ x');
    });
  });

  test('CRLF right after a hard boundary and before $$: the \\r is neither content nor a space', () => {
    expect(preprocessLaTeX('`c`\r\n$$ x')).toBe('`c`');
    expect(preprocessLaTeX('`c`\r\n    $$ x')).toBe('`c`\r\n    $$ x');
    expect(preprocessLaTeX('`c`\r\n   $$ x')).toBe('`c`');
  });

  test('a lone CR is a line ending for the truncation scan (cr-line-origin)', () => {
    expect(preprocessLaTeX('a\r$$ x')).toBe('a');
    expect(preprocessLaTeX('a\n$$ x')).toBe('a');
  });
});

describe('soft atoms — approved output changes', () => {
  test('parity across a tag', () => {
    expect(preprocessLaTeX('$100 <br> $x')).toBe('$$100 <br> $$x');
    expect(preprocessLaTeX('$5 <b>and</b> $6')).toBe('\\$5 <b>and</b> \\$6');
  });

  test('bracket delimiters across a tag', () => {
    expect(preprocessLaTeX('\\[ a <br> b \\]')).toBe('$$ a <br> b $$');
  });

  test('mhchem separated by a mask is not escaped', () => {
    expect(preprocessLaTeX('$<b>\\ce{H2O}</b>$')).toBe('$$<b>\\ce{H2O}</b>$$');
  });
});

describe('soft atoms — hard boundaries', () => {
  test('a tag spanning a line ending is a hard boundary, exactly as before', () => {
    eachEol((eol) => {
      const opener = expandShape('$a <span{eol} title="x">b$', eol);
      expect(preprocessLaTeX(opener)).toBe(opener);
      expect(splitByProtectedRegions(opener).map((s) => s.kind)).toEqual(['text', 'multilineTag', 'text']);
      const selfClosing = expandShape('$a <br{eol}/>b$', eol);
      expect(preprocessLaTeX(selfClosing)).toBe(selfClosing);
      const closer = expandShape('$a <b>x</b{eol}>b$', eol);
      expect(splitByProtectedRegions(closer).map((s) => s.kind)).toEqual([
        'text',
        'tag',
        'text',
        'multilineTag',
        'text',
      ]);
    });
  });

  test('an unclosed $$ next to a multi-line tag is truncated as before', () => {
    eachEol((eol) => {
      expect(preprocessLaTeX(expandShape('$$ a <span{eol} title="x">b', eol))).toBe(
        expandShape('<span{eol} title="x">b', eol)
      );
    });
  });

  test('code spans and literal elements still end the analysed text', () => {
    expect(preprocessLaTeX('$a `x` b$')).toBe('$a `x` b$');
    expect(preprocessLaTeX('$a <code>x</code> b$')).toBe('$a <code>x</code> b$');
  });
});

describe('soft atoms — masks and restoration', () => {
  test('several atoms on one line are restored in order', () => {
    expect(preprocessLaTeX('$a <b>x</b> <i>y</i> <br> b$')).toBe('$$a <b>x</b> <i>y</i> <br> b$$');
  });

  test('truncation takes the trailing atoms with it', () => {
    expect(preprocessLaTeX('$x$\n$$ a <br> b <i>c</i>')).toBe('$$x$$');
  });

  test('input already containing U+E000 gets the next mask; output is unchanged', () => {
    const input = 'prose \uE000 and $x <br> y$';
    expect(selectMask(input)).toBe('\uE001');
    expect(preprocessLaTeX(input)).toBe('prose \uE000 and $$x <br> y$$');
    expect(preprocessLaTeX('\uE000\uE001 $x <br> y$ \uE001')).toBe('\uE000\uE001 $$x <br> y$$ \uE001');
  });

  test('selectMask: first free code point, null when all 6400 occur', () => {
    expect(selectMask('')).toBe('\uE000');
    expect(selectMask('\uE000')).toBe('\uE001');
    let all = '';
    for (let c = 0xe000; c <= 0xf8ff; c++) all += String.fromCharCode(c);
    expect(selectMask(all)).toBeNull();
    expect(selectMask(all.slice(0, -1))).toBe('\uF8FF');
  });

  test('exhaustion takes the legacy arm (today’s bytes) and never throws', () => {
    let all = '';
    for (let c = 0xe000; c <= 0xf8ff; c++) all += String.fromCharCode(c);
    const doc = `${all} $x <br> y$`;
    expect(preprocessLaTeX(doc)).toBe(processSlice(doc, { legacy: true, probe: false }).out);
    expect(preprocessLaTeX(doc)).toBe(`${all} $x <br> y$`);
  });

  test('a restore-invariant violation falls back to the legacy arm in the same call and reports it', () => {
    __setRestoreFailureInjector((atoms) => atoms.includes('<br>'));
    const r = processSlice('$x <br> y$', { probe: false, mask: '\uE000' });
    expect(r.degradedReason).toBe('restore-invariant');
    expect(r.out).toBe('$x <br> y$');
    expect(preprocessLaTeX('$x <br> y$')).toBe('$x <br> y$');
  });

  test('the legacy arm ignores masks and never degrades', () => {
    const r = processSlice('$x <br> y$', { legacy: true, probe: true });
    expect(r.degradedReason).toBeNull();
    expect(r.out).toBe('$x <br> y$');
  });
});

describe('soft atoms — the mask is lexically inert to every regex in the chain', () => {
  const mask = '\uE000';
  test('character classes', () => {
    expect(/\s/.test(mask)).toBe(false);
    expect(/\S/.test(mask)).toBe(true);
    expect(/[^$\n]/.test(mask)).toBe(true);
    expect(/[\S\s]/.test(mask)).toBe(true);
    expect(/[^a-zA-Z\d]/.test(mask)).toBe(true);
    expect(/[^}]/.test(mask)).toBe(true);
    expect(/[^\\]/.test(mask)).toBe(true);
    expect(/[$\\`|_{}0-9A-Za-z]/.test(mask)).toBe(false);
    expect(`  ${mask}  `.trim()).toBe(mask);
    expect(`x${mask}`.trimEnd()).toBe(`x${mask}`);
  });

  test('transform-level adjacency: every neighbour class is byte-identical after restoration or an approved change', () => {
    // A mask beside each token the chain reacts to. Byte-identical means the
    // restored default output equals the legacy output; the exceptions are
    // the approved classes (§3.4), listed explicitly.
    const neighbours = ['$', '$$', '\\ce{', '\\pu{', '\\[', '\\]', '\\(', '\\)', '|', '\\text{', '_', '{', '}'];
    const approved = new Set<string>([
      // pair-across-tag family
      '$<br>x$',
      '$x<br>$',
      '$$<br>x$$',
      '$$x<br>$$',
      '\\[<br>x\\]',
      '\\[x<br>\\]',
      '\\(<br>x\\)',
      '\\(x<br>\\)',
      // mhchem-split
      '$\\ce{<br>x}$',
      '$<br>\\ce{x}$',
      '$\\pu{<br>x}$',
      '$<br>\\pu{x}$',
    ]);
    for (const n of neighbours) {
      const shapes = [`${n}<br>x`, `x<br>${n}`, `$${n}<br>x$`, `$x<br>${n}$`, `<br>${n}`, `${n}<br>`, `<br><br>${n}`];
      for (const shape of shapes) {
        const legacy = processSlice(shape, { legacy: true, probe: false }).out;
        const def = processSlice(shape, { probe: false, mask }).out;
        if (legacy === def) continue;
        // Not identical: must be a pairing across the atom (the fix itself)
        // or the mhchem split — nothing else.
        const isPairing = /\$\$|\\\[|\\\(/.test(shape) || shape.split('$').length > 2;
        const isMhchem = shape.includes('\\ce{') || shape.includes('\\pu{');
        expect(
          isPairing || isMhchem || approved.has(shape),
          `unclassified difference for ${JSON.stringify(shape)}`
        ).toBe(true);
      }
    }
    // Backslash runs beside a mask, odd and even: a `$` pair across the atom
    // is the pairing class; without a pair the bytes are identical.
    expect(processSlice('$a\\<br>$', { probe: false, mask }).out).toBe('$$a\\<br>$$');
    expect(processSlice('$a\\\\<br>$', { probe: false, mask }).out).toBe('$$a\\\\<br>$$');
    for (const shape of ['a\\<br>b $x$', 'a\\\\<br>b $x$', '\\<br>$x$', '\\\\<br>$x$']) {
      expect(processSlice(shape, { probe: false, mask }).out).toBe(
        processSlice(shape, { legacy: true, probe: false }).out
      );
    }
  });
});
