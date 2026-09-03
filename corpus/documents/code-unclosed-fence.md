# edge-unclosed-tail

A stream that stopped inside a fence: opener present, closer never arrived.

This is its own document because it opens a construct it never closes.
Anything after it would be swallowed, so nothing is after it.

Here is the implementation:

```typescript
export function advance(text: string, to: number): number {
  const nl = text.lastIndexOf('\n', to);
