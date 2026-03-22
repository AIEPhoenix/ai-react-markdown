// Sourced from type-fest v5.4.4
// https://github.com/sindresorhus/type-fest
// SPDX-License-Identifier: (MIT OR CC0-1.0)
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

import type { IsNever } from './is-never.d.ts';

/**
Merges user specified options with default options.

@example
```
type PathsOptions = {maxRecursionDepth?: number; leavesOnly?: boolean};
type DefaultPathsOptions = {maxRecursionDepth: 10; leavesOnly: false};
type SpecifiedOptions = {leavesOnly: true};

type Result = ApplyDefaultOptions<PathsOptions, DefaultPathsOptions, SpecifiedOptions>;
//=> {maxRecursionDepth: 10; leavesOnly: true}
```

@example
```
// Complains if default values are not provided for optional options

type PathsOptions = {maxRecursionDepth?: number; leavesOnly?: boolean};
type DefaultPathsOptions = {maxRecursionDepth: 10};
type SpecifiedOptions = {};

type Result = ApplyDefaultOptions<PathsOptions, DefaultPathsOptions, SpecifiedOptions>;
//                                              ~~~~~~~~~~~~~~~~~~~
// Property 'leavesOnly' is missing in type 'DefaultPathsOptions' but required in type '{ maxRecursionDepth: number; leavesOnly: boolean; }'.
```

@example
```
// Complains if an option's default type does not conform to the expected type

type PathsOptions = {maxRecursionDepth?: number; leavesOnly?: boolean};
type DefaultPathsOptions = {maxRecursionDepth: 10; leavesOnly: 'no'};
type SpecifiedOptions = {};

type Result = ApplyDefaultOptions<PathsOptions, DefaultPathsOptions, SpecifiedOptions>;
//                                              ~~~~~~~~~~~~~~~~~~~
// Types of property 'leavesOnly' are incompatible. Type 'string' is not assignable to type 'boolean'.
```

@example
```
// Complains if an option's specified type does not conform to the expected type

type PathsOptions = {maxRecursionDepth?: number; leavesOnly?: boolean};
type DefaultPathsOptions = {maxRecursionDepth: 10; leavesOnly: false};
type SpecifiedOptions = {leavesOnly: 'yes'};

type Result = ApplyDefaultOptions<PathsOptions, DefaultPathsOptions, SpecifiedOptions>;
//                                                                   ~~~~~~~~~~~~~~~~
// Types of property 'leavesOnly' are incompatible. Type 'string' is not assignable to type 'boolean'.
```
*/
export type ApplyDefaultOptions<
  Options extends object,
  Defaults extends Simplify<
    Omit<Required<Options>, RequiredKeysOf<Options>> & Partial<Record<RequiredKeysOf<Options>, never>>
  >,
  SpecifiedOptions extends Options,
> = If<
  IsAny<SpecifiedOptions>,
  Defaults,
  If<
    IsNever<SpecifiedOptions>,
    Defaults,
    Simplify<
      Merge<
        Defaults,
        {
          [Key in keyof SpecifiedOptions as Key extends OptionalKeysOf<Options>
            ? undefined extends SpecifiedOptions[Key]
              ? never
              : Key
            : Key]: SpecifiedOptions[Key];
        }
      > &
        Required<Options>
    >
  >
>; // `& Required<Options>` ensures that `ApplyDefaultOptions<SomeOption, ...>` is always assignable to `Required<SomeOption>`

/**
Matches any primitive, `void`, `Date`, or `RegExp` value.
*/
export type BuiltIns = Primitive | void | Date | RegExp;

/**
Test if the given function has multiple call signatures.

Needed to handle the case of a single call signature with properties.

Multiple call signatures cannot currently be supported due to a TypeScript limitation.
@see https://github.com/microsoft/TypeScript/issues/29732
*/
export type HasMultipleCallSignatures<T extends (...arguments_: any[]) => unknown> = T extends {
  (...arguments_: infer A): unknown;
  (...arguments_: infer B): unknown;
}
  ? B extends A
    ? A extends B
      ? false
      : true
    : true
  : false;

/**
@see {@link PartialDeep}
*/
export type PartialDeepOptions = {
  /**
	Whether to affect the individual elements of arrays and tuples.

	@default false
	*/
  readonly recurseIntoArrays?: boolean;

  /**
	Allows `undefined` values in non-tuple arrays.

	- When set to `true`, elements of non-tuple arrays can be `undefined`.
	- When set to `false`, only explicitly defined elements are allowed in non-tuple arrays, ensuring stricter type checking.

	@default false

	@example
	You can allow `undefined` values in non-tuple arrays by passing `{recurseIntoArrays: true; allowUndefinedInNonTupleArrays: true}` as the second type argument:

	```
	import type {PartialDeep} from 'type-fest';

	type Settings = {
		languages: string[];
	};

	declare const partialSettings: PartialDeep<Settings, {recurseIntoArrays: true; allowUndefinedInNonTupleArrays: true}>;

	partialSettings.languages = [undefined]; // OK
	```
	*/
  readonly allowUndefinedInNonTupleArrays?: boolean;
};

type DefaultPartialDeepOptions = {
  recurseIntoArrays: false;
  allowUndefinedInNonTupleArrays: false;
};

/**
Create a type from another type with all keys and nested keys set to optional.

Use-cases:
- Merging a default settings/config object with another object, the second object would be a deep partial of the default object.
- Mocking and testing complex entities, where populating an entire object with its keys would be redundant in terms of the mock or test.

@example
```
import type {PartialDeep} from 'type-fest';

let settings = {
	textEditor: {
		fontSize: 14,
		fontColor: '#000000',
		fontWeight: 400,
	},
	autocomplete: false,
	autosave: true,
};

const applySavedSettings = (savedSettings: PartialDeep<typeof settings>) => (
	{...settings, ...savedSettings, textEditor: {...settings.textEditor, ...savedSettings.textEditor}}
);

settings = applySavedSettings({textEditor: {fontWeight: 500}});
```

By default, this does not affect elements in array and tuple types. You can change this by passing `{recurseIntoArrays: true}` as the second type argument:

```
import type {PartialDeep} from 'type-fest';

type Shape = {
	dimensions: [number, number];
};

const partialShape: PartialDeep<Shape, {recurseIntoArrays: true}> = {
	dimensions: [], // OK
};

partialShape.dimensions = [15]; // OK
```

@see {@link PartialDeepOptions}

@category Object
@category Array
@category Set
@category Map
*/
export type PartialDeep<T, Options extends PartialDeepOptions = {}> = _PartialDeep<
  T,
  ApplyDefaultOptions<PartialDeepOptions, DefaultPartialDeepOptions, Options>
>;

type _PartialDeep<T, Options extends Required<PartialDeepOptions>> = T extends
  | BuiltIns
  | (new (...arguments_: any[]) => unknown)
  ? T
  : T extends Map<infer KeyType, infer ValueType>
    ? PartialMapDeep<KeyType, ValueType, Options>
    : T extends Set<infer ItemType>
      ? PartialSetDeep<ItemType, Options>
      : T extends ReadonlyMap<infer KeyType, infer ValueType>
        ? PartialReadonlyMapDeep<KeyType, ValueType, Options>
        : T extends ReadonlySet<infer ItemType>
          ? PartialReadonlySetDeep<ItemType, Options>
          : T extends (...arguments_: any[]) => unknown
            ? IsNever<keyof T> extends true
              ? T // For functions with no properties
              : HasMultipleCallSignatures<T> extends true
                ? T
                : ((...arguments_: Parameters<T>) => ReturnType<T>) & PartialObjectDeep<T, Options>
            : T extends object
              ? T extends ReadonlyArray<infer ItemType> // Test for arrays/tuples, per https://github.com/microsoft/TypeScript/issues/35156
                ? Options['recurseIntoArrays'] extends true
                  ? ItemType[] extends T // Test for arrays (non-tuples) specifically
                    ? readonly ItemType[] extends T // Differentiate readonly and mutable arrays
                      ? ReadonlyArray<
                          _PartialDeep<
                            Options['allowUndefinedInNonTupleArrays'] extends false ? ItemType : ItemType | undefined,
                            Options
                          >
                        >
                      : Array<
                          _PartialDeep<
                            Options['allowUndefinedInNonTupleArrays'] extends false ? ItemType : ItemType | undefined,
                            Options
                          >
                        >
                    : PartialObjectDeep<T, Options> // Tuples behave properly
                  : T // If they don't opt into array testing, just use the original type
                : PartialObjectDeep<T, Options>
              : unknown;

/**
Same as `PartialDeep`, but accepts only `Map`s and as inputs. Internal helper for `PartialDeep`.
*/
type PartialMapDeep<KeyType, ValueType, Options extends Required<PartialDeepOptions>> = {} & Map<
  _PartialDeep<KeyType, Options>,
  _PartialDeep<ValueType, Options>
>;

/**
Same as `PartialDeep`, but accepts only `Set`s as inputs. Internal helper for `PartialDeep`.
*/
type PartialSetDeep<T, Options extends Required<PartialDeepOptions>> = {} & Set<_PartialDeep<T, Options>>;

/**
Same as `PartialDeep`, but accepts only `ReadonlyMap`s as inputs. Internal helper for `PartialDeep`.
*/
type PartialReadonlyMapDeep<KeyType, ValueType, Options extends Required<PartialDeepOptions>> = {} & ReadonlyMap<
  _PartialDeep<KeyType, Options>,
  _PartialDeep<ValueType, Options>
>;

/**
Same as `PartialDeep`, but accepts only `ReadonlySet`s as inputs. Internal helper for `PartialDeep`.
*/
type PartialReadonlySetDeep<T, Options extends Required<PartialDeepOptions>> = {} & ReadonlySet<
  _PartialDeep<T, Options>
>;

/**
Same as `PartialDeep`, but accepts only `object`s as inputs. Internal helper for `PartialDeep`.
*/
type PartialObjectDeep<ObjectType extends object, Options extends Required<PartialDeepOptions>> = {
  [KeyType in keyof ObjectType]?: _PartialDeep<ObjectType[KeyType], Options>;
};

export {};
