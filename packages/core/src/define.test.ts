import { describe, expect, test } from 'vitest';
import { defineBehaviors, definePipeline, defineTheme } from './define';
import { highlight } from './plugins/catalog';

describe('define* factories — identity + types + freeze, zero logic', () => {
  test('defineTheme returns the same object, frozen, without filling defaults', () => {
    const input = { fontSize: 15, variant: 'default' as const };
    const out = defineTheme(input);
    expect(out).toBe(input);
    expect(Object.isFrozen(out)).toBe(true);
    // No default-filling — defaults live only in the component's destructuring.
    expect('colorScheme' in out).toBe(false);
  });

  test('defineBehaviors returns the same object, frozen', () => {
    const input = { blockMemo: false };
    const out = defineBehaviors(input);
    expect(out).toBe(input);
    expect(Object.isFrozen(out)).toBe(true);
  });

  test('definePipeline returns the same object, frozen', () => {
    const input = { enginePlugins: [highlight] };
    const out = definePipeline(input);
    expect(out).toBe(input);
    expect(Object.isFrozen(out)).toBe(true);
  });

  test('factories reject fields from other systems at compile time', () => {
    // @ts-expect-error — blockMemo is a Behaviors field, not a Theme field.
    defineTheme({ fontSize: 15, blockMemo: false });
    // @ts-expect-error — fontSize is a Theme field, not a Behaviors field.
    defineBehaviors({ fontSize: 15 });
    // @ts-expect-error — content is a Data field; per-frame values get no factory.
    definePipeline({ content: 'x' });
  });
});
