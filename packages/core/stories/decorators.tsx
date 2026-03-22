import React from 'react';
import type { Decorator } from '@storybook/react-vite';

export const withThemedBackground: Decorator = (Story, context) => {
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
  document.body.style.backgroundColor = theme === 'dark' ? 'rgb(36, 36, 36)' : '';
  return <Story />;
};
