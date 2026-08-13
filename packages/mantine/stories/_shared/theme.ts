import { createTheme } from '@mantine/core';

/**
 * The `MantineProvider` theme every Mantine story runs under. Empty on
 * purpose: the point of these stories is that the wrapper inherits whatever
 * theme the host app supplies, so the baseline has to be Mantine's own
 * defaults.
 *
 * It lives in its own module rather than in `_shared/meta.ts` because
 * `decorators.tsx` needs it too, and `meta.ts` imports `decorators.tsx` —
 * putting the theme in `meta.ts` would close that import cycle.
 */
export const storyTheme = createTheme({});
