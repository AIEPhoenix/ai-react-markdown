import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdownRenderStateProvider, {
  AIMarkdownMetadataProvider,
  useAIMarkdownMetadata,
  useAIMarkdownRenderState,
} from './context';
import {
  AIMarkdownRenderConfig,
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

// ── Extended-generic contract (wrapper-hook pattern) ─────────────────────────
//
// The `useAIMarkdownRenderState<TConfig>()` generic is a *caller-asserted* type
// that TypeScript cannot verify at runtime. The intended pattern is to wrap it
// in a narrow project-local hook that pins the assertion in one place next to
// a matching `defaultConfig`. These tests exercise that happy path and the
// documented failure mode when the caller does not align.

// ── Extension-package-authored surface (simulated) ────
interface ExtendedConfig extends AIMarkdownRenderConfig {
  /** Custom field only the extension package knows about. */
  themeMode: 'light' | 'dark' | 'auto';
}

const extendedDefaultConfig: ExtendedConfig = {
  ...defaultAIMarkdownRenderConfig,
  themeMode: 'auto',
};

const useExtendedRenderState = () => useAIMarkdownRenderState<ExtendedConfig>();

function ExtendedProbe() {
  // Consumer uses the narrow wrapper hook — no raw generic visible here.
  const { config } = useExtendedRenderState();
  return <span data-testid="themeMode">{config.themeMode}</span>;
}

describe('useAIMarkdownRenderState extended generic (wrapper-hook pattern)', () => {
  test('wrapper pattern: extended TConfig is correctly surfaced at runtime', () => {
    const html = renderToString(
      <AIMarkdownRenderStateProvider<ExtendedConfig>
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
        defaultConfig={extendedDefaultConfig}
      >
        <ExtendedProbe />
      </AIMarkdownRenderStateProvider>
    );
    expect(html).toContain('data-testid="themeMode">auto<');
  });

  test('wrapper pattern: user config deep-merges with extended defaults', () => {
    // The customizer replaces array-typed fields, but scalar `themeMode` is
    // overridden by the user's partial config as a normal deep-merge would.
    const html = renderToString(
      <AIMarkdownRenderStateProvider<ExtendedConfig>
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
        defaultConfig={extendedDefaultConfig}
        config={{ themeMode: 'dark' }}
      >
        <ExtendedProbe />
      </AIMarkdownRenderStateProvider>
    );
    expect(html).toContain('data-testid="themeMode">dark<');
  });

  test('documented failure mode: omitting defaultConfig breaks the caller assertion', () => {
    // This codifies the caller-responsibility contract in the JSDoc. When a
    // caller asserts `<ExtendedConfig>` but the provider was NOT configured
    // with a matching `defaultConfig`, the extended field is `undefined` at
    // runtime — exactly as the JSDoc warns. If this assertion were silently
    // "safe", we would be lying about the contract.
    const html = renderToString(
      <AIMarkdownRenderStateProvider
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
        // No defaultConfig — falls back to base shape without `themeMode`.
      >
        <ExtendedProbe />
      </AIMarkdownRenderStateProvider>
    );
    // Template literal renders the missing field as empty string.
    expect(html).toContain('data-testid="themeMode"></span>');
  });
});

// ── useAIMarkdownMetadata wrapper pattern ────────────────────────────────────

interface ExtendedMeta {
  userId: string;
  role: 'admin' | 'viewer';
}

const useExtendedMetadata = () => useAIMarkdownMetadata<ExtendedMeta>();

function MetadataProbe() {
  const meta = useExtendedMetadata();
  return (
    <>
      <span data-testid="userId">{meta?.userId ?? ''}</span>
      <span data-testid="role">{meta?.role ?? ''}</span>
    </>
  );
}

describe('useAIMarkdownMetadata extended generic (wrapper-hook pattern)', () => {
  test('returns the provider-supplied metadata typed as TMetadata', () => {
    const html = renderToString(
      <AIMarkdownMetadataProvider<ExtendedMeta> metadata={{ userId: 'u_42', role: 'admin' }}>
        <MetadataProbe />
      </AIMarkdownMetadataProvider>
    );
    expect(html).toContain('data-testid="userId">u_42<');
    expect(html).toContain('data-testid="role">admin<');
  });

  test('returns undefined when no metadata is provided (no runtime fallback)', () => {
    // Unlike render-state config, metadata has no defaultConfig-style fallback.
    // The hook consistently yields `undefined` when the provider receives none,
    // regardless of the asserted TMetadata.
    const html = renderToString(
      <AIMarkdownMetadataProvider>
        <MetadataProbe />
      </AIMarkdownMetadataProvider>
    );
    expect(html).toContain('data-testid="userId"></span>');
    expect(html).toContain('data-testid="role"></span>');
  });
});
