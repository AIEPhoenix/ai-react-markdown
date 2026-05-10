/**
 * Default typography wrapper component.
 *
 * Renders a `<div>` container that applies CSS class names for the active
 * variant and color scheme, and sets the root font-size as an inline style.
 * The corresponding CSS custom properties are defined in the SCSS variant
 * files under `typography/variants/`.
 *
 * Consumers can replace this with a custom {@link AIMarkdownTypographyComponent}
 * via the `Typography` prop on `<AIMarkdown>`.
 *
 * @module components/typography/Default
 */

import { memo, useMemo } from 'react';
import type { AIMarkdownTypographyProps } from '../../defs';

const DefaultTypography = memo(({ children, fontSize, variant, colorScheme, style }: AIMarkdownTypographyProps) => {
  const className = useMemo(
    () => ['aim-typography-root', variant, colorScheme].filter(Boolean).join(' '),
    [variant, colorScheme]
  );
  const mergedStyle = useMemo(() => ({ width: '100%' as const, fontSize, ...style }), [fontSize, style]);
  return (
    <div className={className} style={mergedStyle}>
      {children}
    </div>
  );
});

DefaultTypography.displayName = 'DefaultTypography';

export default DefaultTypography;
