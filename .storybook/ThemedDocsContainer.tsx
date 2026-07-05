import React, { useEffect, useState } from 'react';
import { DocsContainer } from '@storybook/addon-docs/blocks';
import { themes } from 'storybook/theming';
import { addons } from 'storybook/preview-api';
import { GLOBALS_UPDATED } from 'storybook/internal/core-events';
import { getUserPreferredColorTheme } from './utils/sb-theme';

/**
 * A Docs container that themes the autodocs / MDX **page chrome** (background,
 * prose, doc blocks) to match the toolbar Theme switch.
 *
 * `addon-docs` themes the Docs page from `parameters.docs.theme`, which is
 * static and defaults to the light theme — so the custom `theme` global drives
 * the embedded story previews and the manager UI, but the Docs page itself
 * stays light. This container closes that gap: it seeds from the persisted
 * preference and then subscribes to `GLOBALS_UPDATED` on the preview channel so
 * a live toggle re-themes the page immediately.
 */
export function ThemedDocsContainer(props: React.ComponentProps<typeof DocsContainer>) {
  const [isDark, setIsDark] = useState(() => getUserPreferredColorTheme() === 'dark');

  useEffect(() => {
    const channel = addons.getChannel();
    const handler = (event: { globals?: Record<string, unknown> }) => {
      const theme = event?.globals?.theme;
      if (typeof theme === 'string') setIsDark(theme === 'dark');
    };
    channel.on(GLOBALS_UPDATED, handler);
    return () => channel.off(GLOBALS_UPDATED, handler);
  }, []);

  return <DocsContainer {...props} theme={isDark ? themes.dark : themes.light} />;
}
