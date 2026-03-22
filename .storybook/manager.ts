import { addons } from 'storybook/manager-api';
import { themes } from 'storybook/theming';
import { getUserPreferredColorTheme, setUserPreferredColorTheme } from './utils/sb-theme';
import { GLOBALS_UPDATED } from 'storybook/internal/core-events';

addons.setConfig({
  theme: getUserPreferredColorTheme() === 'dark' ? themes.dark : themes.light,
});

addons.register('theme-switcher', (api) => {
  let currTheme: string | undefined = undefined;

  function updateTheme() {
    const theme = getUserPreferredColorTheme();
    if (theme && currTheme !== theme) {
      currTheme = theme;
      api.setOptions({
        theme: theme === 'dark' ? themes.dark : themes.light,
      });
    }
  }

  api.on(GLOBALS_UPDATED, ({ globals }) => {
    if (globals.theme) {
      setUserPreferredColorTheme(globals.theme);
      updateTheme();
    }
  });

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    updateTheme();
  });
});
