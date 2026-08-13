import { createContext, useContext, type ReactNode } from 'react';

export type StoryColorScheme = 'light' | 'dark';

export interface PagePalette {
  /**
   * Written straight onto `document.body.style.backgroundColor`. The light
   * entry is intentionally empty: clearing the inline value lets Storybook's
   * own canvas background show through, which is what the canvas expects.
   */
  background: string;
  /** Body text color, inherited by every story through the decorator's wrapper. */
  text: string;
}

/**
 * The single source of truth for story page chrome. These values used to be
 * hardcoded in packages/core/stories/decorators.tsx; the text colors match
 * `getStreamingTheme()` in packages/core/stories/streaming/theme.ts so the
 * benchmark harnesses and plain stories agree on foreground contrast.
 */
export const PAGE_PALETTE: Record<StoryColorScheme, PagePalette> = {
  light: { background: '', text: 'rgba(0, 0, 0, 0.88)' },
  dark: { background: 'rgb(36, 36, 36)', text: 'rgba(255, 255, 255, 0.92)' },
};

export const ColorSchemeContext = createContext<StoryColorScheme>('light');

/**
 * The story-side view of the `theme` toolbar global. Provided by
 * `withColorScheme` (a global decorator, so it wraps every story and every
 * component-level decorator). Call this instead of reading
 * `context.globals.theme` — the docs page freezes `context.globals`, so
 * direct reads go stale there while this context stays live.
 */
export const useStoryColorScheme = (): StoryColorScheme => useContext(ColorSchemeContext);

/**
 * Bridge for story `render` slots. A `render` function is a plain function,
 * not a component, so it cannot call `useStoryColorScheme()` directly — this
 * is the smallest legal place to make the call:
 *
 * ```tsx
 * render: (args) => <WithScheme>{(scheme) => <Thing colorScheme={scheme} />}</WithScheme>
 * ```
 */
export const WithScheme = ({ children }: { children: (colorScheme: StoryColorScheme) => ReactNode }) => {
  const colorScheme = useStoryColorScheme();
  return <>{children(colorScheme)}</>;
};
