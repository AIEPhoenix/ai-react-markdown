import React from 'react';
import { AIMarkdownExtraStylesComponent } from '@ai-react-markdown/core';
import './styles.scss';

/**
 * Default extra styles wrapper for the Mantine integration.
 *
 * Wraps markdown content in a `<div>` with the `aim-mantine-extra-styles` CSS class,
 * which provides Mantine-compatible typography overrides including:
 * - Relative `em`-based Mantine spacing and font-size CSS custom properties
 * - Heading, list, paragraph, blockquote, and code styling
 * - Definition list layout
 *
 * Used as the default `ExtraStyles` prop in {@link MantineAIMarkdown}.
 */
const MantineAIMDefaultExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => {
  return <div className="aim-mantine-extra-styles">{children}</div>;
};

export default MantineAIMDefaultExtraStyles;
