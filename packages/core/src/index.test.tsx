import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdown from '.';

describe('AIMarkdown fontSize normalization', () => {
  // Regression: the old truthiness check `fontSize ? ...` treated the literal
  // `0` as "missing" and resolved to the rem default instead of `'0px'`. The
  // fix branches on `fontSize == null || fontSize === ''` (null/undefined and
  // the empty string are "absent"), so all real values (0 included) are
  // forwarded through `${n}px` or the string as-is.

  test('fontSize={0} resolves to "0px" (not the rem default)', () => {
    const html = renderToString(<AIMarkdown content="hello" fontSize={0} />);
    expect(html).toContain('0px');
    expect(html).not.toContain('0.9375rem');
  });

  test('omitted fontSize resolves to the rem default', () => {
    const html = renderToString(<AIMarkdown content="hello" />);
    expect(html).toContain('0.9375rem');
  });

  // Regression: `fontSize=""` (a blanked text input, or a Storybook `text`
  // control left empty) used to be forwarded verbatim. An empty custom
  // property is the guaranteed-invalid value, so `--aim-font-size-root`
  // vanished from the Typography root and every variable derived from it fell
  // back to browser defaults — visibly, code-block language labels rendered
  // at the inherited 16px instead of the intended 0.75em.
  test('empty-string fontSize resolves to the rem default', () => {
    const html = renderToString(<AIMarkdown content="hello" fontSize="" />);
    expect(html).toContain('0.9375rem');
  });

  test('numeric fontSize resolves to "{n}px"', () => {
    const html = renderToString(<AIMarkdown content="hello" fontSize={14} />);
    expect(html).toContain('14px');
  });

  test('string fontSize is forwarded verbatim', () => {
    const html = renderToString(<AIMarkdown content="hello" fontSize="1em" />);
    expect(html).toContain('1em');
  });
});
