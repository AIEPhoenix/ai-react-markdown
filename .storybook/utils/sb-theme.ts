const STORAGE_KEY = 'aim-storybook-color-scheme';

export const getUserPreferredColorTheme = (): string => {
  const theme = localStorage.getItem(STORAGE_KEY);
  if (theme) return theme;
  if (!window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const setUserPreferredColorTheme = (theme: string) => {
  localStorage.setItem(STORAGE_KEY, theme);
};
