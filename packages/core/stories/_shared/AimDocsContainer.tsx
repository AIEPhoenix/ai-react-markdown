import { useEffect, useState, type ComponentProps } from 'react';
import { DocsContainer } from '@storybook/addon-docs/blocks';
import { addons } from 'storybook/preview-api';
import { themes } from 'storybook/theming';
import { GLOBALS_UPDATED } from 'storybook/internal/core-events';
import { getUserPreferredColorTheme } from '../../../../.storybook/utils/sb-theme';
import type { StoryColorScheme } from './colorScheme';

const normalize = (theme: unknown): StoryColorScheme => (theme === 'dark' ? 'dark' : 'light');

/**
 * Docs-page shell that follows the `theme` toolbar global. The container is
 * not a decorator, so `useGlobals` is unavailable here — the channel event is
 * the only live signal. The initial value comes from the same persisted
 * preference the manager chrome reads, so the shell and the sidebar agree on
 * first paint.
 */
export const AimDocsContainer = (props: ComponentProps<typeof DocsContainer>) => {
  const [scheme, setScheme] = useState<StoryColorScheme>(() => normalize(getUserPreferredColorTheme()));

  useEffect(() => {
    const channel = addons.getChannel();
    const onGlobalsUpdated = ({ globals }: { globals: Record<string, unknown> }) => {
      setScheme(normalize(globals.theme));
    };
    channel.on(GLOBALS_UPDATED, onGlobalsUpdated);
    return () => {
      channel.off(GLOBALS_UPDATED, onGlobalsUpdated);
    };
  }, []);

  // Swap the `theme` prop only. Passing a theme-derived `key` would remount the
  // container on every toggle, which tears down the docs context and leaves the
  // page stuck on "No Preview".
  return <DocsContainer {...props} theme={scheme === 'dark' ? themes.dark : themes.light} />;
};
