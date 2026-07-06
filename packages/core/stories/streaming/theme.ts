export type ColorScheme = 'light' | 'dark';

export interface StreamingTheme {
  text: string;
  textMuted: string;
  panelBg: string;
  panelBorder: string;
  surfaceBorder: string;
  buttonBorder: string;
  buttonText: string;
  primaryBg: string;
  primaryText: string;
  chunkBg: string;
  chunkBorder: string;
  chunkText: string;
  chunkMuted: string;
  chunkIndex: string;
  chunkDelay: string;
  chunkSize: string;
  good: string;
  warn: string;
  bad: string;
}

/**
 * Thin, theme-tinted scrollbar as inline-able CSS (the standard
 * `scrollbar-width` / `scrollbar-color` pair — supported by Chrome 121+ and
 * Firefox, no ::-webkit-scrollbar style injection needed). Spread into the
 * style of any `overflow: auto` container; also settable on
 * `document.documentElement` to slim a page's own viewport scrollbar.
 */
export const thinScrollbar = (theme: StreamingTheme): { scrollbarWidth: 'thin'; scrollbarColor: string } => ({
  scrollbarWidth: 'thin',
  scrollbarColor: `${theme.panelBorder} transparent`,
});

export const getStreamingTheme = (scheme: ColorScheme): StreamingTheme => {
  const dark = scheme === 'dark';
  return {
    text: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.88)',
    textMuted: dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
    panelBg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    panelBorder: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
    surfaceBorder: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
    buttonBorder: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
    buttonText: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.88)',
    primaryBg: dark ? '#fafafa' : '#1a1a1a',
    primaryText: dark ? '#1a1a1a' : '#fafafa',
    chunkBg: dark ? 'rgb(24, 24, 27)' : '#f6f8fa',
    chunkBorder: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    chunkText: dark ? '#d4d4d4' : '#1f2328',
    chunkMuted: dark ? '#888' : '#6e7781',
    chunkIndex: dark ? '#6a9955' : '#1a7f37',
    chunkDelay: dark ? '#569cd6' : '#0550ae',
    chunkSize: dark ? '#ce9178' : '#bf3989',
    good: dark ? 'rgb(82, 196, 26)' : 'rgb(31, 137, 56)',
    warn: dark ? 'rgb(250, 173, 20)' : 'rgb(180, 124, 0)',
    bad: dark ? 'rgb(255, 77, 79)' : 'rgb(207, 34, 46)',
  };
};
