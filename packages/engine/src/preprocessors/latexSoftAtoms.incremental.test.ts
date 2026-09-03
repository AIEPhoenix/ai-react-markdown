/**
 * The incremental wrapper under the soft-atom model: mask selection over
 * the COMPLETE current source, lineage-level degradation that recomputes the
 * current call, the reset boundary, and the presence-before-trigger /
 * trigger-before-exhaustion orderings. Every assertion is byte-equality with
 * `preprocessLaTeX(full)` — the one contract this file is not allowed to
 * break.
 */
import { describe, expect, test, afterEach, vi } from 'vitest';
import { preprocessLaTeX, createIncrementalLatexPreprocessor, __setRestoreFailureInjector } from './latex';
import { LINE_ENDINGS, expandShape } from './latexSoftAtomFixtures';

afterEach(() => {
  __setRestoreFailureInjector(null);
  vi.restoreAllMocks();
});

function allPua(): string {
  let all = '';
  for (let c = 0xe000; c <= 0xf8ff; c++) all += String.fromCharCode(c);
  return all;
}

interface Driver {
  feed: (source: string) => string;
  attempts: Array<{ activeLength: number; frozenBytes: number }>;
  degradations: string[];
}

function driver(): Driver {
  const attempts: Driver['attempts'] = [];
  const degradations: string[] = [];
  const inc = createIncrementalLatexPreprocessor({
    freezeThreshold: 0,
    backoff: false,
    onAttempt: (info) => attempts.push(info),
    onDegrade: (reason) => degradations.push(reason),
  });
  return {
    feed: (source) => {
      const got = inc(source);
      expect(got, `frame ${JSON.stringify(source.slice(-40))}`).toBe(preprocessLaTeX(source));
      return got;
    },
    attempts,
    degradations,
  };
}

/** Replay every prefix of `doc`, asserting equality at each. */
function replayPrefixes(doc: string, d = driver()): Driver {
  for (let i = 1; i <= doc.length; i++) d.feed(doc.slice(0, i));
  return d;
}

describe('soft atoms — equivalence over the fixture shapes at every prefix', () => {
  test('scope shapes, in every line ending', () => {
    for (const [, eol] of LINE_ENDINGS) {
      for (const shape of [
        '$x$ ok{eol}<b>\\text{x</b> $y${eol}tail $z${eol}',
        '$x$ ok{eol}<b>$$ x</b> $y${eol}tail $z${eol}',
        '$x$ ok{eol}<b>\\[x</b> $y${eol}tail $z${eol}',
        '$x$ ok{eol}$a <span{eol} title="x">b${eol}tail $z${eol}',
        '$x <br> y${eol}$$ a <br> b $${eol}| $a <b>x</b> b$ |{eol}',
      ]) {
        replayPrefixes(expandShape(shape, eol));
      }
    }
  });

  test('a completed scope in a frozen prefix is byte-stable under later appends', () => {
    const d = driver();
    d.feed('$x$ ok\n<b>\\text{x</b> $y$\n');
    d.feed('$x$ ok\n<b>\\text{x</b> $y$\nmore $z$\n');
    d.feed('$x$ ok\n<b>\\text{x</b> $y$\nmore $z$\nand $w$ end\n');
    expect(d.attempts.some((a) => a.frozenBytes > 0)).toBe(true);
  });
});

describe('soft atoms — lineage degradation', () => {
  test('same-call degradation on exhaustion, permanence, reset on a new lineage', () => {
    const d = driver();
    // An ordinary prefix that freezes.
    d.feed('$x$ ok\n');
    d.feed('$x$ ok\nmore $y$\n');
    expect(d.attempts.some((a) => a.frozenBytes > 0)).toBe(true);
    // The append completes the private-use alphabet: this very call is
    // whole-source legacy, and equals the stateless result.
    d.feed(`$x$ ok\nmore $y$\n${allPua()} $a <br> b$\n`);
    expect(d.degradations).toEqual(['mask-exhausted']);
    // Still degraded on the next append.
    d.feed(`$x$ ok\nmore $y$\n${allPua()} $a <br> b$\nand $c <br> d$\n`);
    expect(d.degradations).toEqual(['mask-exhausted']);
    // A new lineage (non-append) clears it and freezes again.
    const before = d.attempts.length;
    d.feed('fresh $q$\n');
    d.feed('fresh $q$\nline $r <br> s$\n');
    expect(d.attempts.slice(before).some((a) => a.frozenBytes > 0)).toBe(true);
    expect(d.degradations).toEqual(['mask-exhausted']);
  });

  test('same-call degradation on an injected restore failure inside a nested scope', () => {
    __setRestoreFailureInjector((atoms) => atoms.some((a) => a.startsWith('<i>')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = driver();
    d.feed('$x$ ok\n');
    d.feed('$x$ ok\nmore $y$\n');
    d.feed('$x$ ok\nmore $y$\n<b>a <i>$q$</i> b</b> $z$\n');
    expect(d.degradations).toEqual(['restore-invariant']);
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls[0][0]).toContain('restoration violated its invariant');
    d.feed('$x$ ok\nmore $y$\n<b>a <i>$q$</i> b</b> $z$\nmore $w$\n');
    expect(d.degradations).toEqual(['restore-invariant']);
    // New lineage: clean again.
    __setRestoreFailureInjector(null);
    d.feed('fresh $q$\n');
    d.feed('fresh $q$\nline $r <br> s$\n');
    expect(d.degradations).toEqual(['restore-invariant']);
  });

  test('distributed exhaustion: no single slice holds the full set', () => {
    const all = allPua();
    const half = Math.floor(all.length / 2);
    for (const variant of ['alone', 'tag-adjacent'] as const) {
      const d = driver();
      d.feed(`$x$ ${all.slice(0, half)}\n`);
      d.feed(`$x$ ${all.slice(0, half)}\nmid $y <br> z$\n`);
      expect(d.attempts.some((a) => a.frozenBytes > 0)).toBe(true);
      const rest = all.slice(half, -1);
      d.feed(`$x$ ${all.slice(0, half)}\nmid $y <br> z$\n${rest}\n`);
      expect(d.degradations).toEqual([]);
      const last = all.slice(-1);
      const tail = variant === 'alone' ? `${last}\n` : `$p <br> ${last} q$\n`;
      d.feed(`$x$ ${all.slice(0, half)}\nmid $y <br> z$\n${rest}\n${tail}`);
      expect(d.degradations).toEqual(['mask-exhausted']);
      d.feed(`$x$ ${all.slice(0, half)}\nmid $y <br> z$\n${rest}\n${tail}and $c <br> d$\n`);
      expect(d.degradations).toEqual(['mask-exhausted']);
    }
  });

  test('replay after degradation: cached output, no extra attempt, no second diagnostic; then one appended byte', () => {
    __setRestoreFailureInjector((atoms) => atoms.includes('<br>'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A raw instance here: the driver's stateless comparison would itself
    // trip the injector and log, which is exactly what this test counts.
    const attempts: number[] = [];
    const degradations: string[] = [];
    const inc = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      backoff: false,
      onAttempt: (i) => attempts.push(i.frozenBytes),
      onDegrade: (r) => degradations.push(r),
    });
    inc('$x$ ok\n');
    const doc = '$x$ ok\n$a <br> b$\n';
    const want = preprocessLaTeX(doc);
    errSpy.mockClear();
    expect(inc(doc)).toBe(want);
    expect(degradations).toEqual(['restore-invariant']);
    expect(attempts).toHaveLength(2);
    expect(errSpy).toHaveBeenCalledTimes(1);
    // Identical replay: cached, no attempt, no second diagnostic.
    expect(inc(doc)).toBe(want);
    expect(attempts).toHaveLength(2);
    expect(errSpy).toHaveBeenCalledTimes(1);
    // One appended byte: still degraded, still equal to stateless.
    errSpy.mockClear();
    expect(inc(`${doc}z`)).toBe(preprocessLaTeX(`${doc}z`));
    expect(degradations).toEqual(['restore-invariant']);
  });

  test('a candidate that degrades still yields exactly one onAttempt with frozenBytes 0', () => {
    __setRestoreFailureInjector((atoms) => atoms.includes('<br>'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = driver();
    // The very first call already attempts a freeze (freezeThreshold 0);
    // its candidate holds the atom the injector rejects, so the call
    // degrades — and still reports exactly one attempt, with nothing frozen.
    d.feed('$a <br> b$\n');
    expect(d.degradations).toEqual(['restore-invariant']);
    expect(d.attempts).toHaveLength(1);
    expect(d.attempts[0].frozenBytes).toBe(0);
    // A degraded lineage attempts nothing further.
    d.feed('$a <br> b$\nmore $c$\n');
    expect(d.attempts).toHaveLength(1);
  });
});

describe('soft atoms — presence accounting and ordering', () => {
  test('presence before trigger: a literal U+E000 in a trigger-free first frame is still counted', () => {
    const d = driver();
    d.feed('prose \uE000 here\n');
    d.feed('prose \uE000 here\n$x <br> y$\n');
    expect(d.degradations).toEqual([]);
  });

  test('several private-use values over several trigger-free frames', () => {
    const d = driver();
    d.feed('a \uE000\n');
    d.feed('a \uE000\nb \uE001\n');
    d.feed('a \uE000\nb \uE001\nc \uE002\n');
    d.feed('a \uE000\nb \uE001\nc \uE002\n$x <br> y$\n');
    expect(d.degradations).toEqual([]);
  });

  test('trigger before exhaustion: a trigger-free input holding every code point plus \\text{a_b} is returned unchanged', () => {
    const doc = `${allPua()} \\text{a_b}\n`;
    expect(preprocessLaTeX(doc)).toBe(doc);
    const d = driver();
    d.feed(doc);
    expect(d.degradations).toEqual([]);
    // The first trigger degrades in that same call (the set is already full).
    d.feed(`${doc}$x <br> y$\n`);
    expect(d.degradations).toEqual(['mask-exhausted']);
  });

  test('bitmap uniqueness: the same code point repeated thousands of times counts once', () => {
    const d = driver();
    d.feed(`${'\uE000'.repeat(7000)}\n`);
    d.feed(`${'\uE000'.repeat(7000)}\n$x <br> y$\n`);
    expect(d.degradations).toEqual([]);
  });
});
