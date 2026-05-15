import { describe, expect, test } from 'vitest';
import { sanitize } from 'hast-util-sanitize';
import { extendSanitizeSchema } from './extendSanitizeSchema';
import { sanitizeSchema as defaultLibrarySchema } from './sanitizeSchema';

describe('extendSanitizeSchema — mutate-and-return form', () => {
  test('mutate-only: appending to a protocol allowlist via push()', () => {
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
    });
    expect(schema.protocols?.href).toContain('myapp');
    expect(schema.protocols?.href).toContain('https');
    expect(schema.protocols?.href).toContain('mailto');
  });

  test('return-replace: returning a fresh schema overrides the draft', () => {
    const schema = extendSanitizeSchema((s) => ({
      ...s,
      protocols: {
        ...s.protocols,
        href: ['https', 'myapp'],
      },
    }));
    expect(schema.protocols?.href).toEqual(['https', 'myapp']);
  });

  test('mutating the draft does NOT mutate the library default singleton', () => {
    // The whole point of cloning before handing the draft over.
    const beforeHref = [...(defaultLibrarySchema.protocols?.href ?? [])];
    extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
      // Aggressively poke deeper structures too — none should leak back.
      s.tagNames!.push('mythical-tag');
      s.attributes!.code = [['className', /^injected-/]];
    });
    expect(defaultLibrarySchema.protocols?.href).toEqual(beforeHref);
    expect(defaultLibrarySchema.tagNames).not.toContain('mythical-tag');
    // Default attributes.code retains the original code className tuple.
    const codeAttrs = defaultLibrarySchema.attributes?.code ?? [];
    const codeClassEntry = codeAttrs.find((e) => Array.isArray(e) && e[0] === 'className');
    expect(codeClassEntry).toBeDefined();
  });

  test('two consecutive calls return independent schemas (no shared mutation)', () => {
    const a = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
    });
    const b = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('otherapp');
    });
    expect(a.protocols?.href).toContain('myapp');
    expect(a.protocols?.href).not.toContain('otherapp');
    expect(b.protocols?.href).toContain('otherapp');
    expect(b.protocols?.href).not.toContain('myapp');
  });

  test('preserves cross-chunk tag allowlist (the footgun this helper exists to prevent)', () => {
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
    });
    expect(schema.tagNames).toContain('cross-chunk-link');
    expect(schema.tagNames).toContain('cross-chunk-image');
    expect(schema.tagNames).toContain('footnote-sup');
  });

  test('preserves math className allowlist on <code> (RegExp survives the deep clone)', () => {
    // Critical: the deep clone must preserve RegExp. A JSON-based deep clone
    // would silently corrupt these into `{}` objects, breaking the className
    // filter. lodash `cloneDeep` is RegExp-safe (as is native structuredClone,
    // which we previously considered but dropped over mobile-Safari support).
    const schema = extendSanitizeSchema(() => {});
    const codeAttrs = schema.attributes?.code ?? [];
    const classNameEntry = codeAttrs.find((entry) => Array.isArray(entry) && entry[0] === 'className') as
      | readonly unknown[]
      | undefined;
    expect(classNameEntry).toBeDefined();
    // The RegExp from defaultSchema should still BE a RegExp (not a plain object).
    expect(classNameEntry!.some((v) => v instanceof RegExp)).toBe(true);
    expect(classNameEntry).toContain('math-inline');
    expect(classNameEntry).toContain('math-display');
  });

  test('end-to-end: sanitize keeps an extended-protocol href', () => {
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
    });
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'myapp://x' },
          children: [{ type: 'text', value: 'click' }],
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = sanitize(tree as any, schema as any) as any;
    expect(out.children[0].properties.href).toBe('myapp://x');
  });

  test('end-to-end: sanitize still strips javascript: even after extension', () => {
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
    });
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'javascript:alert(1)' },
          children: [{ type: 'text', value: 'xss' }],
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = sanitize(tree as any, schema as any) as any;
    expect(out.children[0].properties.href).toBeUndefined();
  });

  test('a no-op modifier (returns nothing, mutates nothing) still returns a usable schema', () => {
    const schema = extendSanitizeSchema(() => {});
    expect(schema.tagNames).toContain('cross-chunk-link');
    expect(schema.protocols?.href).toContain('https');
  });

  test('an explicitly-returned undefined falls through to the draft', () => {
    // Some callers may write `(s) => { s.x = 1; return; }` — the trailing
    // bare `return` produces undefined. The helper must treat that the same
    // as mutate-only.
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.src!.push('myapp');
      return undefined;
    });
    expect(schema.protocols?.src).toContain('myapp');
  });
});
