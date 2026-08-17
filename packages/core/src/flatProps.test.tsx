/**
 * Integration tests for the v2 flat prop surface: explicit prop
 * (`v != null`) > shipped default, asserted through the behaviors context
 * and the rendered output of an actual `<AIMarkdown>`.
 */
import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdown, { AIMarkdownSmoothStream, AIMarkdownStreamingCursor } from '.';
import { AIMarkdownDocuments } from './components/AIMarkdownDocuments';
import { useAIMarkdownBehaviors, useAIMarkdownState, useAIMarkdownTheme } from './context';
import { highlight, pangu } from '@ai-react-markdown/engine';

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

describe('library-wide null guard — theme/state/component slices (§3.7)', () => {
  test('null theme/state props fall to the shipped defaults', () => {
    let theme: ReturnType<typeof useAIMarkdownTheme> | null = null;
    let state: ReturnType<typeof useAIMarkdownState> | null = null;
    const Probe = () => {
      // eslint-disable-next-line react-hooks/globals
      theme = useAIMarkdownTheme();
      // eslint-disable-next-line react-hooks/globals
      state = useAIMarkdownState();
      return null;
    };
    renderToString(
      <AIMarkdown
        content="hello"
        streaming={null as never}
        fontSize={null as never}
        variant={null as never}
        colorScheme={null as never}
        Typography={Probe as never}
      />
    );
    expect(theme).toEqual({ fontSize: '0.9375rem', variant: 'default', colorScheme: 'light' });
    expect(state).toEqual({ streaming: false });
  });

  test('Typography: null falls back to the default typography instead of crashing', () => {
    const html = renderToString(<AIMarkdown content="hello" Typography={null as never} />);
    expect(html).toContain('hello');
  });

  test('null object props (customComponents/sanitizeSchema/…) count as absent', () => {
    const html = renderToString(
      <AIMarkdown
        content="==mark== **bold**"
        customComponents={null as never}
        sanitizeSchema={null as never}
        contentPreprocessors={null as never}
        urlTransform={null}
        enginePlugins={null as never}
        metadata={null as never}
        ExtraStyles={null as never}
        streamingCursor={null as never}
      />
    );
    expect(html).toContain('<mark>');
    expect(html).toContain('<strong>');
  });

  test('fontSize={0} still resolves to 0px (guard branches on null, not truthiness)', () => {
    const html = renderToString(<AIMarkdown content="hello" fontSize={0} />);
    expect(html).toContain('--aim-font-size-root:0px');
  });
});

describe('library-wide null guard — AIMarkdownSmoothStream shell (§3.7)', () => {
  test('smoothCoordination={null} counts as absent (default true), not as false', () => {
    // Observable on the server: behind a streaming predecessor, an EMPTY
    // streaming successor is gated by the coordinator — rendered empty and
    // NOT streaming (no cursor slot). With coordination off it keeps its
    // cursor. A destructuring default left null in place and turned
    // coordination off silently.
    const render = (smoothCoordination: boolean | null) =>
      renderToString(
        <AIMarkdownDocuments>
          <AIMarkdownSmoothStream documentId="doc" content="first chunk" streaming />
          <AIMarkdownSmoothStream
            documentId="doc"
            content=""
            streaming
            smoothCoordination={smoothCoordination as never}
            streamingCursor={AIMarkdownStreamingCursor}
          />
        </AIMarkdownDocuments>
      );
    const on = render(true);
    const off = render(false);
    expect(on).not.toContain('data-aimd-streaming-cursor');
    expect(off).toContain('data-aimd-streaming-cursor');
    expect(render(null)).toBe(on);
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
