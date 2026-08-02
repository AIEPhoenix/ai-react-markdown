/**
 * Integration tests for the v2 flat prop surface: explicit prop
 * (`v != null`) > shipped default, asserted through the behaviors context
 * and the rendered output of an actual `<AIMarkdown>`.
 */
import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdown from '.';
import { useAIMarkdownBehaviors } from './context';
import { highlight, pangu } from './plugins/catalog';

/** Renders `<AIMarkdown>` with a Typography-slot probe capturing the behaviors payload. */
function captureBehaviors(props: Partial<Parameters<typeof AIMarkdown>[0]>) {
  let captured: ReturnType<typeof useAIMarkdownBehaviors> | null = null;
  const Probe = () => {
    // eslint-disable-next-line react-hooks/globals
    captured = useAIMarkdownBehaviors();
    return null;
  };
  renderToString(<AIMarkdown content="hello" {...props} Typography={Probe as never} />);
  if (captured === null) throw new Error('probe never rendered');
  return captured as ReturnType<typeof useAIMarkdownBehaviors>;
}

describe('flat props — precedence through <AIMarkdown>', () => {
  test('nothing passed → shipped defaults', () => {
    const behaviors = captureBehaviors({});
    expect(behaviors).toEqual({ blockMemo: true, incrementalParse: true, preserveOrphanReferences: true });
  });

  test('explicit flat props win', () => {
    const behaviors = captureBehaviors({ blockMemo: false, incrementalParse: false, preserveOrphanReferences: false });
    expect(behaviors.blockMemo).toBe(false);
    expect(behaviors.incrementalParse).toBe(false);
    expect(behaviors.preserveOrphanReferences).toBe(false);
  });

  test('null flat prop counts as absent (punch-through guard)', () => {
    const behaviors = captureBehaviors({ blockMemo: null as never, incrementalParse: null as never });
    expect(behaviors.blockMemo).toBe(true);
    expect(behaviors.incrementalParse).toBe(true);
  });
});

describe('enginePlugins — selection drives the produced chain', () => {
  test('default set renders highlight syntax', () => {
    const html = renderToString(<AIMarkdown content="==mark== **bold**" />);
    expect(html).toContain('<mark>');
    expect(html).toContain('<strong>');
  });

  test('explicit selection without highlight drops the syntax', () => {
    const html = renderToString(<AIMarkdown content="==mark== **bold**" enginePlugins={[pangu]} />);
    expect(html).not.toContain('<mark>');
    expect(html).toContain('<strong>');
  });

  test('empty selection turns every optional plugin off but core GFM still renders', () => {
    const html = renderToString(<AIMarkdown content="==mark== ~~gone~~" enginePlugins={[]} />);
    expect(html).not.toContain('<mark>');
    expect(html).toContain('<del>');
  });

  test('rendered output works end-to-end with flat props combined', () => {
    const html = renderToString(
      <AIMarkdown content="==mark== **bold**" enginePlugins={[highlight]} blockMemo={false} />
    );
    expect(html).toContain('<mark>');
    expect(html).toContain('<strong>');
  });
});
