import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdownRenderStateProvider, { useAIMarkdownRenderState } from './context';
import {
  AIMarkdownRenderDisplayOptimizeAbility,
  AIMarkdownRenderExtraSyntax,
  defaultAIMarkdownRenderConfig,
} from './defs';

function ConfigProbe() {
  const { config } = useAIMarkdownRenderState();
  return (
    <>
      <span data-testid="extra">{config.extraSyntaxSupported.join(',')}</span>
      <span data-testid="optimize">{config.displayOptimizeAbilities.join(',')}</span>
    </>
  );
}

describe('AIMarkdownRenderStateProvider config merge', () => {
  test('does not mutate the frozen default config when user config is provided', () => {
    const snapshot = JSON.stringify(defaultAIMarkdownRenderConfig);

    renderToString(
      <AIMarkdownRenderStateProvider
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
        config={{
          extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT],
          displayOptimizeAbilities: [AIMarkdownRenderDisplayOptimizeAbility.PANGU],
        }}
      >
        <ConfigProbe />
      </AIMarkdownRenderStateProvider>
    );

    expect(JSON.stringify(defaultAIMarkdownRenderConfig)).toBe(snapshot);
  });

  test('does not mutate an UNFROZEN defaultConfig passed by a consumer', () => {
    // Distinguishes the post-fix `mergeWith({}, base, src)` from the buggy
    // shape `mergeWith(base, src)`: the latter would mutate `base` in place.
    // Using a plain (unfrozen) object here means a regression would be
    // observable — the frozen singleton cannot catch this because strict-mode
    // throws masked the issue.
    const consumerDefault = {
      extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT],
      displayOptimizeAbilities: [AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS],
    };
    const snapshot = JSON.stringify(consumerDefault);

    renderToString(
      <AIMarkdownRenderStateProvider
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
        defaultConfig={consumerDefault}
        config={{
          extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.SUBSCRIPT],
          displayOptimizeAbilities: [AIMarkdownRenderDisplayOptimizeAbility.PANGU],
        }}
      >
        <ConfigProbe />
      </AIMarkdownRenderStateProvider>
    );

    expect(JSON.stringify(consumerDefault)).toBe(snapshot);
  });

  test('user arrays fully replace default arrays (customizer behavior)', () => {
    const html = renderToString(
      <AIMarkdownRenderStateProvider
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
        config={{
          extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT],
        }}
      >
        <ConfigProbe />
      </AIMarkdownRenderStateProvider>
    );
    // Only the explicitly overridden value should appear — the customizer
    // replaces arrays wholesale rather than merging them by index.
    expect(html).toContain(`data-testid="extra">${AIMarkdownRenderExtraSyntax.HIGHLIGHT}<`);
    // Non-overridden arrays fall back to the default's values.
    expect(html).toContain('REMOVE_COMMENTS,SMARTYPANTS,PANGU');
  });

  test('without a user config, the default config is exposed directly', () => {
    const html = renderToString(
      <AIMarkdownRenderStateProvider
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
      >
        <ConfigProbe />
      </AIMarkdownRenderStateProvider>
    );
    expect(html).toContain('HIGHLIGHT,DEFINITION_LIST,SUBSCRIPT');
    expect(html).toContain('REMOVE_COMMENTS,SMARTYPANTS,PANGU');
  });
});
