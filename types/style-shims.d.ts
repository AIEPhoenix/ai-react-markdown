// Ambient module declarations for style imports in stories / Storybook config.
// tsc has no CSS pipeline; Vite handles these at build time. Referenced by the
// tsconfig.stories.json of each package and the root tsconfig.storybook.json.
declare module '*.css';
declare module '*.scss';
