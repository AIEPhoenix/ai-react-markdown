import { memo } from 'react';
import { Typography } from '@mantine/core';
import type { AIMarkdownTypographyProps } from '@ai-react-markdown/core';

/**
 * Mantine-themed typography wrapper for AI markdown content.
 *
 * Replaces the core default typography component with Mantine's `<Typography>`
 * element, applying the configured `fontSize` at full width. This ensures all
 * rendered markdown inherits Mantine's font family, line height, and theming.
 *
 * Used as the default `Typography` prop in {@link MantineAIMarkdown}.
 * Can be replaced by passing a custom `Typography` component.
 *
 * @param props - Standard {@link AIMarkdownTypographyProps} from the core package.
 */
const MantineAIMarkdownTypography = memo(({ children, fontSize, style }: AIMarkdownTypographyProps) => (
  <Typography w="100%" fz={fontSize} style={style}>
    {children}
  </Typography>
));

MantineAIMarkdownTypography.displayName = 'MantineAIMarkdownTypography';

export default MantineAIMarkdownTypography;
