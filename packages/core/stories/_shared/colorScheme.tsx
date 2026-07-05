import React from 'react';

/**
 * The active Storybook color scheme, provided by the `withThemedBackground`
 * decorator (which subscribes to the globals channel via `useGlobals`).
 *
 * Why a React context instead of reading `context.globals.theme` in each
 * render: inside autodocs **Docs pages**, an embedded story's render is not
 * re-invoked when a global changes via the toolbar — so `context.globals`
 * stays frozen and the light/dark switch appears dead. The decorator DOES
 * re-render (its `useGlobals` call subscribes it to the channel), so feeding
 * the value down through context lets every nested component pick up live
 * theme changes with a plain `useContext` — in both Canvas and Docs.
 */
export const ColorSchemeContext = React.createContext<'light' | 'dark'>('light');

/** Read the live color scheme. Safe in any component rendered inside a story. */
export function useColorScheme(): 'light' | 'dark' {
  return React.useContext(ColorSchemeContext);
}
