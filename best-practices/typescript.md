# TypeScript & Type Helpers

Type conventions for all TypeScript in the monorepo, and a catalog of the type-helper libraries we install so you
**don't reinvent them**. Many rules here are enforced by `oxlint` (see
[`vite.config.ts`](../vite.config.ts)).

## Helper catalog

[es-toolkit](#es-toolkit--runtime-utilities) · [ts-extras](#ts-extras--typed-built-ins) · [type-fest](#type-fest--compile-time-helpers) · [ts-reset](#total-typescriptts-reset--application-wide-declarations) · [ts-pattern](#ts-pattern--pattern-matching)

## Conventions

- **No `any`.** If a value is genuinely unknown, type it `unknown` and narrow it.
- **Avoid `as` type assertions.** They silence the compiler. To narrow, prefer, in order: a **type guard**
  (`value is T`) → **`invariant(...)`** (runtime-checked) → **`assertNever`** / **`ts-pattern` `.exhaustive()`** for
  unions. (`as const` is fine — the ban is on _type assertions_.)
- **Prefer `type` over `interface`.** Reach for `interface` only when you need a feature it uniquely provides (e.g.
  declaration merging).
- **Let return types infer.** Add an explicit return type only to lock a public/shared API contract.
- **Prefer string-literal unions over `enum`s**; pair them with exhaustive handling.
- **Prefix boolean variables** with `is`/`has` (`isLoading`, `hasError`).
- **Validate external data with `zod`** at the boundary (never trust network/env input).

## Type narrowing — order of preference

1. **Type guard** — a `function isThing(x: unknown): x is Thing` predicate.
2. **`invariant(cond, msg)`** (`es-toolkit`) — asserts a runtime assumption and narrows afterward.
3. **`assertNever(x)`** (`ts-extras`) / **`match(x).exhaustive()`** (`ts-pattern`) — for exhaustive unions.

Do **not** reach for `as`.

## `ts-extras` — typed built-ins

| Helper | Use |
| --- | --- |
| `arrayAt` | Return the item at the given index like `Array#at()`, but with stronger typing for tuples. |
| `arrayConcat` | A strongly-typed version of `Array#concat()` that properly handles arrays of different types. |
| `arrayFirst` | Return the first item of an array with stronger typing for tuples. |
| `arrayIncludes` | A strongly-typed version of `Array#includes()` that properly acts as a type guard. |
| `arrayJoin` | A strongly-typed version of `Array#join()` that preserves literal string types. |
| `arrayLast` | Return the last item of an array with stronger typing for tuples. |
| `assert` | Assert that the given condition is truthy. |
| `assertDefined` | Assert that the given value is defined, meaning it is not `undefined`. |
| `assertError` | Assert that the given value is an `Error`. |
| `assertNever` | Assert that a code path is unreachable. |
| `assertPresent` | Assert that the given value is present (non-nullable), meaning it is neither `null` nor `undefined`. |
| `asWritable` | Cast the given value to be [`Writable`](https://github.com/sindresorhus/type-fest/blob/main/source/writable.d.ts). |
| `isDefined` | Check whether a value is defined, meaning it is not `undefined`. |
| `isEmpty` | Check whether an array is empty. |
| `isEqualType` | Check if two types are equal at compile time. |
| `isFinite` | A strongly-typed version of `Number.isFinite()`. |
| `isInfinite` | Check whether a value is infinite. |
| `isInteger` | A strongly-typed version of `Number.isInteger()`. |
| `isPresent` | Check whether a value is present (non-nullable), meaning it is neither `null` nor `undefined`. |
| `isPropertyDefined` | Check whether a specific own property of a value is defined, meaning it is not `undefined`. |
| `isPropertyPresent` | Check whether a specific own property of a value is present (non-nullable), meaning it is neither `null` nor `undefined`. |
| `isSafeInteger` | A strongly-typed version of `Number.isSafeInteger()`. |
| `keyIn` | Check if a key exists in an object and narrow the key type. |
| `not` | Invert a type predicate function. |
| `objectAssign` | A strongly-typed version of `Object.assign()`. |
| `objectEntries` | A strongly-typed version of `Object.entries()`. |
| `objectFromEntries` | A strongly-typed version of `Object.fromEntries()`. |
| `objectHasIn` | Check if an object has a property (including inherited) and narrow the object type. |
| `objectHasOwn` | A strongly-typed version of `Object.hasOwn()` that narrows the object type. |
| `objectKeys` | A strongly-typed version of `Object.keys()`. |
| `objectMapValues` | A strongly-typed version of mapping over an object's values, preserving keys. |
| `objectUpdate` | Apply a type-checked partial update to an object in place. |
| `objectValues` | A strongly-typed version of `Object.values()`. |
| `safeCastTo` | Constrain a value to the given type safely. |
| `setHas` | A strongly-typed version of `Set#has()` that properly acts as a type guard. |
| `stringSplit` | A strongly-typed version of `String#split()` that returns a tuple for literal strings. |

## `ts-pattern` — pattern matching

Use for branching on unions/shapes instead of `switch` or nested conditionals.

```ts
import { match, P } from "ts-pattern"

const label = match(result)
  .with({ status: "ok", data: P.select() }, (data) => `ok: ${data}`)
  .with({ status: "error", error: P.instanceOf(Error) }, ({ error }) => error.message)
  .with({ status: "loading" }, () => "loading…")
  .exhaustive() // compile error if a case is missing
```

Key API:

- `match(value)` → `.with(pattern, handler)` → terminate with `.exhaustive()` (enforces all cases) or `.otherwise(fn)`
  (default). Use `.returnType<T>()` to pin the return type.
- **Patterns (`P`):** `P._` / `P.any`, `P.string`, `P.number`, `P.boolean`, `P.bigint`, `P.nullish`, `P.array(pattern)`,
  `P.set`, `P.map`, `P.union(...)`, `P.intersection(...)`, `P.not(pattern)`, `P.optional(pattern)`,
  `P.instanceOf(Class)`, `P.when(predicate)`, `P.select()` (extract a value), and string/number refinements like
  `P.string.startsWith(...)`, `P.number.gte(...)`.
- `isMatching(pattern)` — a standalone type guard built from a pattern.

String refinements include `startsWith`, `endsWith`, `includes`, `regex`, `length`, `minLength`, and `maxLength`. Numeric patterns offer `gt`, `gte`, `lt`, `lte`, `between`, `positive`, and `negative`. Number patterns also support `int` and `finite`.

Additional matching APIs include `P` (also exported as `Pattern`), `P.unknown`, `P.symbol`, `P.nonNullable`, `P.record`, and `P.shape`. Combine patterns with `.and()` or `.or()`. Use `P.Pattern<T>` to constrain a pattern, `P.infer<typeof pattern>` for the matched type, or `P.narrow<Input, typeof pattern>` to narrow an existing union. Custom matchers use `P.matcher` and the experimental `P.unstable_Fn`, `P.unstable_Matcher`, and `P.unstable_Matchable` types. A match can branch with `.when()` or evaluate with `.run()`. An unmatched exhaustive evaluation throws `NonExhaustiveError`.

## `es-toolkit` — runtime utilities

```ts
import { invariant } from "es-toolkit"

invariant(user, "user must be loaded before render")
user.name // narrowed to non-null here
```

Use an invariant for a condition the program requires to continue. Use schema validation for untrusted input.

Use named imports from `es-toolkit` for the core helpers. Specialized entry points are labeled with their import path.

### array

| Helper | Use |
| --- | --- |
| `at` | Retrieves elements from an array at the specified indices. |
| `cartesianProduct` | Computes the [Cartesian product](https://en.wikipedia.org/wiki/Cartesian_product) of the input arrays. |
| `chunk` | Splits an array into smaller arrays of a specified length. |
| `chunkBy` | Splits an array into chunks of consecutive elements that share the same key. |
| `combinations` | Returns all `r`-length combinations of elements from the input array. |
| `compact` | Removes falsey values (false, null, 0, -0, 0n, '', undefined, NaN) from an array. |
| `countBy` | Count the occurrences of each item in an array based on a transformation function. |
| `difference` | Computes the difference between two arrays. |
| `differenceBy` | Computes the difference between two arrays after mapping their elements through a provided function. |
| `differenceWith` | Computes the difference between two arrays based on a custom equality function. |
| `drop` | Removes a specified number of elements from the beginning of an array and returns the rest. |
| `dropRight` | Removes a specified number of elements from the end of an array and returns the rest. |
| `dropRightWhile` | Removes elements from the end of an array until the predicate returns false. |
| `dropWhile` | Removes elements from the beginning of an array until the predicate returns false. |
| `fill` | Fills the whole array with a specified value. |
| `filterAsync` | Filters an array asynchronously using an async predicate function. |
| `flatMap` | Maps each element in the array using the iteratee function and flattens the result up to the specified depth. |
| `flatMapAsync` | Maps each element in an array using an async callback function and flattens the result by one level. |
| `flatMapDeep` | Recursively maps each element in an array using a provided iteratee function and then deeply flattens the resulting array. |
| `flatten` | Flattens an array up to the specified depth. |
| `flattenDeep` | Flattens all depths of a nested array. |
| `forEachAsync` | Executes an async callback function for each element in an array. |
| `forEachRight` | Iterates over elements of 'arr' from right to left and invokes 'callback' for each element. |
| `groupBy` | Groups the elements of an array based on a provided key-generating function. |
| `head` | Returns the first element of an array. |
| `initial` | Returns an empty array when the input is a tuple containing exactly one element. |
| `intersection` | Returns the intersection of two arrays. |
| `intersectionBy` | Returns the intersection of two arrays based on a mapping function. |
| `intersectionWith` | Returns the intersection of two arrays based on a custom equality function. |
| `isSubset` | Checks if the `subset` array is entirely contained within the `superset` array. |
| `isSubsetWith` | Checks if the `subset` array is entirely contained within the `superset` array based on a custom equality function. |
| `keyBy` | Maps each element of an array based on a provided key-generating function. |
| `last` | Returns the last element of an array. |
| `limitAsync` | Wraps an async function to limit the number of concurrent executions. |
| `mapAsync` | Transforms each element in an array using an async callback function and returns a promise that resolves to an array of transformed values. |
| `maxBy` | Finds the element in an array that has the maximum value when applying the `getValue` function to each element. |
| `minBy` | Finds the element in an array that has the minimum value when applying the `getValue` function to each element. |
| `orderBy` | Sorts an array of objects based on the given `criteria` and their corresponding order directions. |
| `partition` | Splits an array into two groups based on a predicate function. |
| `pull` | Removes all specified values from an array. |
| `pullAt` | Removes elements from an array at specified indices and returns the removed elements. |
| `reduceAsync` | Reduces an array to a single value using an async reducer function. |
| `remove` | Removes elements from an array based on a predicate function. |
| `sample` | Returns a random element from an array. |
| `sampleSize` | Returns a sample element array of a specified `size`. |
| `shuffle` | Randomizes the order of elements in an array using the Fisher-Yates algorithm. |
| `sortBy` | Sorts an array of objects based on the given `criteria`. |
| `tail` | Returns an empty array when the input is a single-element array. |
| `take` | Returns a new array containing the first `count` elements from the input array `arr`. |
| `takeRight` | Returns a new array containing the last `count` elements from the input array `arr`. |
| `takeRightWhile` | Takes elements from the end of the array while the predicate function returns `true`. |
| `takeWhile` | Returns a new array containing the leading elements of the provided array that satisfy the provided predicate function. |
| `toFilled` | Creates a new array filled with the specified value from the start position up to, but not including, the end position. |
| `union` | Creates an array of unique values from all given arrays. |
| `unionBy` | Creates an array of unique values, in order, from all given arrays using a provided mapping function to determine equality. |
| `unionWith` | Creates an array of unique values from two given arrays based on a custom equality function. |
| `uniq` | Creates a duplicate-free version of an array. |
| `uniqBy` | Returns a new array containing only the unique elements from the original array, based on the values returned by the mapper function. |
| `uniqWith` | Returns a new array containing only the unique elements from the original array, based on the values returned by the comparator function. |
| `unzip` | Gathers elements in the same position in an internal array from a grouped array of elements and returns them as a new array. |
| `unzipWith` | Unzips an array of arrays, applying an `iteratee` function to regrouped elements. |
| `windowed` | Creates an array of sub-arrays (windows) from the input array, each of the specified size. |
| `without` | Creates an array that excludes all specified values. |
| `xor` | Computes the symmetric difference between two arrays. |
| `xorBy` | Computes the symmetric difference between two arrays using a custom mapping function. |
| `xorWith` | Computes the symmetric difference between two arrays using a custom equality function. |
| `zip` | Combines multiple arrays into a single array of tuples. |
| `zipObject` | Combines two arrays, one of property names and one of corresponding values, into a single object. |
| `zipWith` | Combines multiple arrays into a single array using a custom combiner function. |

### `es-toolkit/bigint`

| Helper | Use |
| --- | --- |
| `clamp` | Clamps a bigint within the inclusive lower and upper bounds. |
| `inRange` | Checks whether a bigint is within a range. |
| `max` | Finds the largest bigint in an array. |
| `maxBy` | Finds the element in an array that has the largest bigint value returned by `getValue`. |
| `median` | Calculates the median of an array of bigints. |
| `medianBy` | Calculates the median of an array by mapping each element to a bigint. |
| `min` | Finds the smallest bigint in an array. |
| `minBy` | Finds the element in an array that has the smallest bigint value returned by `getValue`. |
| `percentile` | Calculates the value at a given percentile in an array of bigints. |
| `range` | Returns an array of bigints from `0n` up to, but not including, `end`. |
| `rangeRight` | Returns an array of bigints from `0n` up to, but not including, `end`, in descending order. |
| `sum` | Calculates the sum of an array of bigints. |
| `sumBy` | Calculates the sum of an array by mapping each element to a bigint. |

### `es-toolkit/server`

| Helper | Use |
| --- | --- |
| `ColorFunction` | Type a terminal text-coloring function. |
| `colors` | Apply terminal colors to text. |
| `exec` | Executes a command and captures its output. |
| `ExecError` | Represents an error thrown when a process exits with a non-zero exit code. |

### error

| Helper | Use |
| --- | --- |
| `AbortError` | An error class representing an aborted operation. |
| `TimeoutError` | An error class representing a timeout operation. |

### function

| Helper | Use |
| --- | --- |
| `after` | Creates a function that only executes starting from the `n`-th call. |
| `ary` | Creates a function that invokes func, with up to n arguments, ignoring any additional arguments. |
| `asyncNoop` | An asynchronous no-operation function that does nothing. |
| `before` | Creates a function that limits the number of times the given function (`func`) can be called. |
| `curry` | Curries a function, allowing it to be called with a single argument at a time and returning a new function that takes the next argument. |
| `curryRight` | Curries a function, allowing it to be called with a single argument at a time and returning a new function that takes the next argument. |
| `debounce` | Creates a debounced function that delays invoking the provided function until after `debounceMs` milliseconds have elapsed since the last time the debounced function was invoked. |
| `DebouncedFunction` | Type a debounced callable and its control methods. |
| `DebounceOptions` | Configure debounce timing and invocation. |
| `flow` | Creates a new function that executes the given functions in sequence. |
| `flowRight` | Creates a new function that executes the given functions in sequence from right to left. |
| `identity` | Returns the input value unchanged. |
| `memoize` | Creates a memoized version of the provided function. |
| `MemoizeCache` | Represents a cache for memoization, allowing storage and retrieval of computed values. |
| `negate` | Creates a function that negates the result of the predicate function. |
| `noop` | A no-operation function that does nothing. |
| `once` | Creates a function that is restricted to invoking func once. |
| `partial` | Creates a function that invokes `func` with `partialArgs` prepended to the arguments it receives. |
| `partialRight` | This method is like `partial` except that partially applied arguments are appended to the arguments it receives. |
| `rest` | Creates a function that transforms the arguments of the provided function `func`. |
| `retry` | Retries a function that returns a promise until it resolves successfully. |
| `spread` | Creates a new function that spreads elements of an array argument into individual arguments for the original function. |
| `throttle` | Creates a throttled function that only invokes the provided function at most once per every `throttleMs` milliseconds. |
| `ThrottledFunction` | Type a throttled callable and its control methods. |
| `ThrottleOptions` | Configure throttle timing and invocation. |
| `unary` | Creates a function that accepts up to one argument, ignoring any additional arguments. |

### `es-toolkit/iterator`

| Helper | Use |
| --- | --- |
| `cartesianProduct` | Lazily computes the [Cartesian product](https://en.wikipedia.org/wiki/Cartesian_product) of the source iterators, yielding every possible tuple formed by picking one element from each source, in lexicographic order — the rightmost source advances fastest, like the digits of an odometer. |
| `chunk` | Lazily groups the elements of `source` into arrays of length `size`. |
| `count` | Consumes `source` and returns the number of elements it produces. |
| `dropWhile` | Lazily skips elements from `source` as long as `shouldDrop` returns a truthy value, then yields every remaining element (including the one that first failed the predicate). |
| `head` | Returns the first element produced by `source`, or `undefined` if it is empty. |
| `iterate` | Creates an infinite lazy iterator that starts with `seed` and repeatedly applies `getNext` to produce the following value: `seed`, `getNext(seed)`, `getNext(getNext(seed))`, and so on. |
| `partition` | Consumes `source` and splits its elements into two arrays: the first holds the elements for which `predicate` returns truthy, the second holds the rest. |
| `range` | Lazily yields numbers from `0` (inclusive) up to `end` (exclusive), incrementing by `1`. |
| `scan` | Lazily yields the running accumulation of `source` under `callback`, like a `reduce` that emits every intermediate result. |
| `takeWhile` | Lazily yields elements from `source` as long as `shouldContinue` returns a truthy value, stopping at (and excluding) the first element for which it returns a falsy value. |
| `uniqBy` | Lazily yields the elements of `source` whose mapped key has not been seen before, preserving the order of first occurrence. |
| `zip` | Lazily combines several iterators into a single iterator of tuples, pairing the elements at matching positions. |

### `es-toolkit/map`

| Helper | Use |
| --- | --- |
| `countBy` | Counts the occurrences of items in a Map based on a transformation function. |
| `every` | Tests whether all entries in a Map satisfy the provided predicate function. |
| `filter` | Filters a Map based on a predicate function. |
| `findKey` | Finds the first key in a Map for which the predicate function returns true. |
| `findValue` | Finds the first value in a Map for which the predicate function returns true. |
| `forEach` | Executes a provided function once for each entry in a Map. |
| `hasValue` | Checks if a Map contains a specific value. |
| `keyBy` | Maps each entry of a Map based on a provided key-generating function. |
| `mapKeys` | Creates a new Map with the same values but with keys transformed by the provided function. |
| `mapValues` | Creates a new Map with the same keys but with values transformed by the provided function. |
| `reduce` | Reduces a Map to a single value by iterating through its entries and applying a callback function. |
| `some` | Tests whether at least one entry in a Map satisfies the provided predicate function. |

### math

| Helper | Use |
| --- | --- |
| `clamp` | Clamps a number within the inclusive upper bound. |
| `inRange` | Checks if the value is less than the maximum. |
| `inverseLerp` | Returns where `value` lies between `start` and `stop`, as a fraction from `0` to `1`. |
| `lerp` | Returns the number that lies at `fraction` of the way between `start` and `stop`, using linear interpolation. |
| `mean` | Calculates the average of an array of numbers. |
| `meanBy` | Calculates the average of an array of numbers when applying the `getValue` function to each element. |
| `median` | Calculates the median of an array of numbers. |
| `medianBy` | Calculates the median of an array of elements when applying the `getValue` function to each element. |
| `percentile` | Calculates the value at the given percentile of an array of numbers. |
| `random` | Generate a random number within the given range. |
| `randomInt` | Generates a random integer between 0 (inclusive) and the given maximum (exclusive). |
| `range` | Returns an array of numbers from `0` (inclusive) to `end` (exclusive), incrementing by `1`. |
| `rangeRight` | Returns an array of numbers from `end` (exclusive) to `0` (inclusive), decrementing by `1`. |
| `round` | Rounds a number to a specified precision. |
| `sum` | Calculates the sum of an array of numbers. |
| `sumBy` | Calculates the sum of an array of numbers when applying the `getValue` function to each element. |

### object

| Helper | Use |
| --- | --- |
| `clone` | Creates a shallow clone of the given object. |
| `cloneDeep` | Creates a deep clone of the given object. |
| `cloneDeepWith` | Deeply clones the given object. |
| `deepFreeze` | Deeply freezes an object, making it and all nested objects immutable. |
| `findKey` | Finds the key of the first element in the object that satisfies the provided testing function. |
| `flattenObject` | Flattens a nested object into a single level object with delimiter-separated keys. |
| `invert` | Inverts the keys and values of an object. |
| `mapKeys` | Creates a new object with the same values as the given object, but with keys generated by running each own enumerable property of the object through the iteratee function. |
| `mapKeysAsync` | Creates a new object with the same values as the given object, but with keys generated by running each own enumerable property of the object through the async iteratee function. |
| `mapValues` | Creates a new object with the same keys as the given object, but with values generated by running each own enumerable property of the object through the iteratee function. |
| `mapValuesAsync` | Creates a new object with the same keys as the given object, but with values generated by running each own enumerable property of the object through the async iteratee function. |
| `merge` | Merges the properties of the source object into the target object. |
| `mergeWith` | Merges the properties of the source object into the target object. |
| `omit` | Creates a new object with specified keys omitted. |
| `omitBy` | Creates a new object composed of the properties that do not satisfy the predicate function. |
| `pick` | Creates a new object composed of the picked object properties. |
| `pickBy` | Creates a new object composed of the properties that satisfy the predicate function. |
| `sortKeys` | Creates a new object with the keys sorted. |
| `toCamelCaseKeys` | Creates a new object composed of the properties with keys converted to camelCase. |
| `toConstantCaseKeys` | Creates a new object composed of the properties with keys converted to CONSTANT_CASE. |
| `toKebabCaseKeys` | Creates a new object composed of the properties with keys converted to kebab-case. |
| `toMerged` | Merges the properties of the source object into a deep clone of the target object. |
| `toPascalCaseKeys` | Creates a new object composed of the properties with keys converted to PascalCase. |
| `toSnakeCaseKeys` | Creates a new object composed of the properties with keys converted to snake_case. |

### predicate

| Helper | Use |
| --- | --- |
| `isArrayBuffer` | Checks if a given value is `ArrayBuffer`. |
| `isBlob` | Checks if the given value is a Blob. |
| `isBoolean` | Checks if the given value is boolean. |
| `isBrowser` | Checks if the current environment is a browser. |
| `isBuffer` | Checks if the given value is a Buffer instance. |
| `isDate` | Checks if `value` is a Date object. |
| `isEmptyObject` | Checks if a value is an empty plain object. |
| `isEqual` | Checks if two values are equal, including support for `Date`, `RegExp`, and deep object comparison. |
| `isEqualWith` | Compares two values for equality using a custom comparison function. |
| `isError` | Checks if `value` is an Error object. |
| `isFile` | Checks if the given value is a File. |
| `isFunction` | Checks if `value` is a function. |
| `isIterable` | Checks if a value is iterable, i.e. it implements the iterable protocol by providing a `Symbol.iterator` method. |
| `isJSON` | Checks if a given value is a valid JSON string. |
| `isJSONArray` | Checks if a given value is a valid JSON array. |
| `isJSONObject` | Checks if a value is a JSON object. |
| `isJSONValue` | Checks if a given value is a valid JSON value. |
| `isLength` | Checks if a given value is a valid length. |
| `isMap` | Checks if a given value is `Map`. |
| `isNil` | Checks if a given value is null or undefined. |
| `isNode` | Checks if the current environment is Node.js. |
| `isNotNil` | Checks if the given value is not null nor undefined. |
| `isNull` | Checks if the given value is null. |
| `isNumber` | Checks if the given value is a number. |
| `isPlainObject` | Checks if a given value is a plain object. |
| `isPrimitive` | Checks whether a value is a JavaScript primitive. |
| `isPromise` | Checks if a given value is `Promise`. |
| `isRegExp` | Checks if `value` is a RegExp. |
| `isSet` | Checks if a given value is `Set`. |
| `isString` | Checks if a given value is string. |
| `isSymbol` | Check whether a value is a symbol. |
| `isTypedArray` | Checks if a value is a TypedArray. |
| `isUndefined` | Checks if the given value is undefined. |
| `isWeakMap` | Checks if the given value is a `WeakMap`. |
| `isWeakSet` | Checks if the given value is a `WeakSet`. |

### promise

| Helper | Use |
| --- | --- |
| `allKeyed` | Resolves an object of promises concurrently, returning an object with the same keys and resolved values. |
| `delay` | Delays the execution of code for a specified number of milliseconds. |
| `limitAsync` | Wraps an async function to limit the number of concurrent executions. |
| `Mutex` | A Mutex (mutual exclusion lock) for async functions. |
| `Semaphore` | A counting semaphore for async functions that manages available permits. |
| `timeout` | Returns a promise that rejects with a `TimeoutError` after a specified delay. |
| `withTimeout` | Executes an async function and enforces a timeout. |

### `es-toolkit/query-string`

| Helper | Use |
| --- | --- |
| `stringify` | Converts a flat object into a URL search string, such as `?a=1&b=2`. |

### `es-toolkit/set`

| Helper | Use |
| --- | --- |
| `countBy` | Counts the occurrences of items in a Set based on a transformation function. |
| `every` | Tests whether all elements in a Set satisfy the provided predicate function. |
| `filter` | Filters a Set based on a predicate function. |
| `find` | Finds the first element in a Set for which the predicate function returns true. |
| `forEach` | Executes a provided function once for each element in a Set. |
| `keyBy` | Maps each element of a Set based on a provided key-generating function. |
| `map` | Creates a new Set with elements transformed by the provided function. |
| `reduce` | Reduces a Set to a single value by iterating through its elements and applying a callback function. |
| `some` | Tests whether at least one element in a Set satisfies the provided predicate function. |

### string

| Helper | Use |
| --- | --- |
| `camelCase` | Converts a string to camel case. |
| `capitalize` | Converts the first character of string to upper case and the remaining to lower case. |
| `constantCase` | Converts a string to constant case. |
| `deburr` | Converts a string by replacing special characters and diacritical marks with their ASCII equivalents. |
| `dedent` | Removes common leading whitespace from each line of a multi-line string. |
| `escape` | Converts the characters "&", "<", ">", '"', and "'" in `str` to their corresponding HTML entities. |
| `escapeRegExp` | Escapes the RegExp special characters "^", "$", "\\", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", and "\|" in `str`. |
| `kebabCase` | Converts a string to kebab case. |
| `lowerCase` | Converts a string to lower case. |
| `lowerFirst` | Converts the first character of string to lower case. |
| `pad` | Pads string on the left and right sides if it's shorter than length. |
| `pascalCase` | Converts a string to Pascal case. |
| `reverseString` | Reverses a given string. |
| `sentenceCase` | Converts a string to sentence case. |
| `snakeCase` | Converts a string to snake case. |
| `startCase` | Converts the first character of each word in a string to uppercase and the remaining characters to lowercase. |
| `trim` | Removes leading and trailing whitespace or specified characters from a string. |
| `trimEnd` | Removes trailing whitespace or specified characters from a string. |
| `trimStart` | Removes leading whitespace or specified characters from a string. |
| `unescape` | Converts the HTML entities `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` in `str` to their corresponding characters. |
| `upperCase` | Converts a string to upper case. |
| `upperFirst` | Converts the first character of string to upper case. |
| `words` | Splits `string` into an array of its words, treating spaces and punctuation marks as separators. |

### `es-toolkit/types`

| Helper | Use |
| --- | --- |
| `DeepPartial` | Makes all properties of `T` optional recursively, unlike the built-in `Partial` which only affects the first level. |
| `DeepReadonly` | Makes all properties of `T` readonly recursively, unlike the built-in `Readonly` which only affects the first level. |
| `DistributiveOmit` | Removes the given keys from each union member while preserving its remaining properties. |
| `EmptyObject` | An object with no properties. |
| `IsAny` | Resolves to `true` when `T` is `any`, `false` otherwise. |
| `IsEqual` | Resolves to `true` when `A` and `B` are exactly the same type, `false` otherwise. |
| `IsUnknown` | Resolves to `true` when `T` is `unknown`, `false` otherwise. |
| `JSONValue` | Any value that `JSON.parse` can produce. |
| `Merge` | The result of deeply merging the source type `S` into the target type `T`, matching what `merge(target, source)` returns at runtime. |
| `NonEmptyArray` | An array guaranteed to have at least one element. |
| `ObjectKeys` | Creates a union of the keys of `T` as they are returned by `Object.keys`: numeric keys are converted to strings and symbol keys are excluded, while string keys, including enum members, are kept as they are. |
| `Primitive` | Every primitive value in JavaScript. |
| `SetOptional` | Makes the given keys `K` of `T` optional, leaving the rest unchanged. |
| `SetRequired` | Makes the given keys `K` of `T` required, leaving the rest unchanged. |
| `Simplify` | Flattens an intersection or mapped type into a single, readable object type. |
| `ToCamelCaseKeys` | Converts the keys of `T` to camelCase recursively. |
| `ToConstantCaseKeys` | Converts the keys of `T` to CONSTANT_CASE recursively. |
| `ToKebabCaseKeys` | Converts the keys of `T` to kebab-case recursively. |
| `ToPascalCaseKeys` | Converts the keys of `T` to PascalCase recursively. |
| `ToSnakeCaseKeys` | Converts the keys of `T` to snake_case recursively. |
| `UnknownRecord` | An object with unknown keys and unknown values. |
| `ValueOf` | Creates a union of all value types in `T`. |
| `Writable` | Removes the `readonly` modifier from all properties of `T`. |

### util

| Helper | Use |
| --- | --- |
| `assert` | Asserts that a given condition is true. |
| `attempt` | Attempt to execute a function and return the result or error. |
| `attemptAsync` | Attempt to execute an async function and return the result or error. |
| `defer` | Creates a `Disposable` object that runs the given callback when it is disposed. |
| `deferAsync` | Creates an `AsyncDisposable` object that runs the given callback when it is disposed. |
| `invariant` | Asserts that a given condition is true. |
| `Queue` | A first-in, first-out (FIFO) queue backed by a linked list. |
| `serialize` | Serializes any value into a stable string. |

### `es-toolkit/util/hash`

Use `hash(value)` to compute a hash string in Node or the browser.

## `type-fest` — compile-time helpers

Use `import type` for these types. For example, `SetRequired<User, "email">` makes one field required and preserves the rest of the contract.

| Helper | Use |
| --- | --- |
| `Absolute` | Returns the absolute value of the specified number or bigint. |
| `AbstractClass` | Matches an [`abstract class`](https://www.typescriptlang.org/docs/handbook/2/classes.html#abstract-classes-and-members). |
| `AbstractConstructor` | Matches an [`abstract class`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-2.html#abstract-construct-signatures) constructor. |
| `AllExtend` | Returns a boolean for whether every element in an array type extends another type. |
| `AllExtendOptions` | Configure the behavior of `AllExtend`. |
| `AllUnionFields` | Create a type with all fields from a union of object types. |
| `Alphanumeric` | Matches any lowercase letter (a-z), uppercase letter (A-Z), or digit ('0'-'9') in the basic Latin alphabet. |
| `And` | Returns a boolean for whether two given types are both `true`. |
| `AndAll` | Returns a boolean for whether all of the given elements are `true`. |
| `Arrayable` | Create a type that represents either the value or an array of the value. |
| `ArrayElement` | Extracts the element type of an array or tuple. |
| `ArrayIndices` | Provides valid indices for a constant array or tuple. |
| `ArrayLength` | Return the length of an array. |
| `ArrayReverse` | Reverse the order of elements in a tuple type. |
| `ArraySlice` | Returns an array slice of a given range, just like `Array#slice()`. |
| `ArraySplice` | Create a new array type by adding or removing elements at a specified index range in the original array. |
| `ArrayTail` | Extract the type of an array or tuple minus the first element. |
| `ArrayValues` | Provides all values for a constant array or tuple. |
| `Asyncify` | Create an async version of the given function type, by boxing the return type in `Promise` while keeping the same parameter types. |
| `AsyncReturnType` | Unwrap the return type of a function that returns a `Promise`. |
| `CamelCase` | Convert a string literal to camel-case. |
| `CamelCasedProperties` | Convert top-level object properties to camel case. |
| `CamelCasedPropertiesDeep` | Convert object properties to camel case recursively. |
| `CamelCaseOptions` | CamelCase options. |
| `Class` | Matches a [`class`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes). |
| `ConditionalExcept` | Exclude keys from a shape that matches the given `Condition`. |
| `ConditionalKeys` | Extract the keys from a type where the value type of the key extends the given `Condition`. |
| `ConditionalPick` | Pick keys from the shape that matches the given `Condition`. |
| `ConditionalPickDeep` | Pick keys recursively from the shape that matches the given condition. |
| `ConditionalPickDeepOptions` | ConditionalPickDeep options. |
| `ConditionalSimplify` | Simplifies a type while including and/or excluding certain types from being simplified. |
| `ConditionalSimplifyDeep` | Recursively simplifies a type while including and/or excluding certain types from being simplified. |
| `Constructor` | Matches a [`class` constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes). |
| `DelimiterCase` | Convert a string literal to a custom string delimiter casing. |
| `DelimiterCasedProperties` | Convert object properties to a custom string delimiter casing. |
| `DelimiterCasedPropertiesDeep` | Convert object properties to a custom string delimiter casing recursively. |
| `DigitCharacter` | Matches any digit as a string ('0'-'9'). |
| `DistributedOmit` | Omits keys from a type, distributing the operation over a union. |
| `DistributedPick` | Pick keys from a type, distributing the operation over a union. |
| `EmptyObject` | Represents a strictly empty plain object, the `{}` value. |
| `Entries` | Create a type that describes the key-value pairs produced when calling a collection’s `entries` method. |
| `Entry` | Create a type that describes a single key-value pair produced when calling a collection’s `entries` method. |
| `Exact` | Create a type that does not allow extra properties, meaning it only allows properties that are explicitly declared. |
| `Except` | Create a type from an object type without certain keys. |
| `ExceptOptions` | Configure the behavior of `Except`. |
| `ExcludeExactly` | A stricter version of `Exclude<T, U>` that excludes types only when they are exactly identical. |
| `ExcludeRestElement` | Create a tuple with the [`rest`](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types) element removed. |
| `ExcludeStrict` | A stricter version of Exclude<T, U> that ensures every member of `U` can successfully exclude something from `T`. |
| `ExclusifyUnion` | Ensure mutual exclusivity in object unions by adding other members’ keys as `?: never`. |
| `ExtendsStrict` | A customizable version of `extends` for checking whether one type is assignable to another. |
| `ExtendsStrictOptions` | Configure the behavior of `ExtendsStrict`. |
| `ExtractExactly` | A stricter version of `Extract<T, U>` that extracts types only when they are exactly identical. |
| `ExtractRestElement` | Extract the [`rest`](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types) element type from an array. |
| `ExtractStrict` | A stricter version of Extract<T, U> that ensures every member of `U` can successfully extract something from `T`. |
| `FindGlobalInstanceType` | Tries to find one or more types from their globally-defined constructors. |
| `FindGlobalType` | Tries to find the type of a global with the given name. |
| `Finite` | A finite `number`. |
| `FixedLengthArray` | Create a type that represents an array of the given type and length. |
| `Float` | A `number` that is not an integer. |
| `Get` | Get a deeply-nested property from an object using a key path, like [Lodash's `.get()`](https://lodash.com/docs#get) function. |
| `GetOptions` | Configure the behavior of `Get`. |
| `GetTagMetadata` | Given a type and a tag name, returns the metadata associated with that tag on that type. |
| `GlobalThis` | Declare locally scoped properties on `globalThis`. |
| `GreaterThan` | Returns a boolean for whether a given number is greater than another number. |
| `GreaterThanOrEqual` | Returns a boolean for whether a given number is greater than or equal to another number. |
| `HasOptionalKeys` | Returns a boolean for whether the given type has any optional fields. |
| `HasReadonlyKeys` | Returns a boolean for whether the given type has any readonly fields. |
| `HasRequiredKeys` | Returns a boolean for whether the given type has any required fields. |
| `HasWritableKeys` | Returns a boolean for whether the given type has any writable fields. |
| `If` | An if-else-like type that resolves depending on whether the given `boolean` type is `true` or `false`. |
| `IfAny` | An if-else-like type that resolves depending on whether the given type is `any`. |
| `IfEmptyObject` | An if-else-like type that resolves depending on whether the given type is `{}`. |
| `IfNever` | An if-else-like type that resolves depending on whether the given type is `never`. |
| `IfNull` | An if-else-like type that resolves depending on whether the given type is `null`. |
| `IfUnknown` | An if-else-like type that resolves depending on whether the given type is `unknown`. |
| `Includes` | Returns a boolean for whether the given array includes the given item. |
| `IntClosedRange` | Generate a union of numbers between a specified start and end (both inclusive), with an optional step. |
| `Integer` | A `number` that is an integer. |
| `IntRange` | Generate a union of numbers between a specified start (inclusive) and end (exclusive), with an optional step. |
| `InvariantOf` | Create an [invariant type](https://basarat.gitbook.io/typescript/type-system/type-compatibility#footnote-invariance), which is a type that does not accept supertypes and subtypes. |
| `IsAny` | Returns a boolean for whether the given type is `any`. |
| `IsBooleanLiteral` | Returns a boolean for whether the given type is a `true` or `false` [literal type](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types). |
| `IsEmptyObject` | Returns a boolean for whether the type is strictly equal to an empty plain object, the `{}` value. |
| `IsEqual` | Returns a boolean for whether the two given types are equal. |
| `IsFloat` | Returns a boolean for whether the given number is a float, like `1.5` or `-1.5`. |
| `IsInteger` | Returns a boolean for whether the given number is an integer, like `-5`, `1.0`, or `100`. |
| `IsLiteral` | Returns a boolean for whether the given type is a [literal type](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types). |
| `IsLowercase` | Returns a boolean for whether the given string literal is lowercase. |
| `IsNegative` | Returns a boolean for whether the given number is a negative number. |
| `IsNever` | Returns a boolean for whether the given type is `never`. |
| `IsNull` | Returns a boolean for whether the given type is `null`. |
| `IsNullable` | Returns a boolean for whether the given type includes `null`. |
| `IsNumericLiteral` | Returns a boolean for whether the given type is a `number` or `bigint` [literal type](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types). |
| `IsOptional` | Returns a boolean for whether the given type includes `undefined`. |
| `IsOptionalKeyOf` | Returns a boolean for whether the given key is an optional key of type. |
| `IsReadonlyKeyOf` | Returns a boolean for whether the given key is a readonly key of type. |
| `IsRequiredKeyOf` | Returns a boolean for whether the given key is a required key of type. |
| `IsStringLiteral` | Returns a boolean for whether the given type is a `string` [literal type](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types). |
| `IsSymbolLiteral` | Returns a boolean for whether the given type is a `symbol` [literal type](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types). |
| `IsTuple` | Returns a boolean for whether the given array is a tuple. |
| `IsTupleOptions` | Configure the behavior of `IsTuple`. |
| `IsUndefined` | Returns a boolean for whether the given type is `undefined`. |
| `IsUnion` | Returns a boolean for whether the given type is a union. |
| `IsUnknown` | Returns a boolean for whether the given type is `unknown`. |
| `IsUppercase` | Returns a boolean for whether the given string literal is uppercase. |
| `IsWritableKeyOf` | Returns a boolean for whether the given key is a writable key of type. |
| `IterableElement` | Get the element type of an `Iterable`/`AsyncIterable`. |
| `Join` | Join an array of strings and/or numbers using the given string as a delimiter. |
| `JsonArray` | Matches a JSON array. |
| `Jsonifiable` | Matches a value that can be losslessly converted to JSON. |
| `Jsonify` | Transform a type to one that is assignable to the `JsonValue` type. |
| `JsonObject` | Matches a JSON object. |
| `JsonPrimitive` | Matches any valid JSON primitive value. |
| `JsonValue` | Matches any valid JSON value. |
| `KebabCase` | Convert a string literal to kebab-case. |
| `KebabCasedProperties` | Convert top-level object properties to kebab case. |
| `KebabCasedPropertiesDeep` | Convert object properties to kebab case recursively. |
| `KeyAsString` | Get keys of the given type as strings. |
| `KeysOfUnion` | Create a union of all keys from a given type, even those exclusive to specific union members. |
| `LastArrayElement` | Extract the type of the last element of an array. |
| `LessThan` | Returns a boolean for whether a given number is less than another number. |
| `LessThanOrEqual` | Returns a boolean for whether a given number is less than or equal to another number. |
| `LiteralToPrimitive` | Given a [literal type](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types) return the [primitive type](https://developer.mozilla.org/en-US/docs/Glossary/Primitive) it belongs to, or `never` if it's not a primitive. |
| `LiteralToPrimitiveDeep` | Like `LiteralToPrimitive` except it converts literal types inside an object or array deeply. |
| `LiteralUnion` | Create a union type by combining primitive types and literal types without sacrificing auto-completion in IDEs for the literal type part of the union. |
| `LowercaseLetter` | Matches any lowercase letter in the basic Latin alphabet (a-z). |
| `Merge` | Merge two types into a new type. |
| `MergeDeep` | Merge two objects or two arrays/tuples recursively into a new type. |
| `MergeDeepOptions` | MergeDeep options. |
| `MergeExclusive` | Create a type that has mutually exclusive keys. |
| `MultidimensionalArray` | Create a type that represents a multidimensional array of the given type and dimension. |
| `MultidimensionalReadonlyArray` | Create a type that represents a multidimensional readonly array of the given type and dimension. |
| `Negative` | A negative `number`/`bigint` (`-∞ < x < 0`) |
| `NegativeFloat` | A negative (`-∞ < x < 0`) `number` that is not an integer. |
| `NegativeInfinity` | Matches the hidden `-Infinity` type. |
| `NegativeInteger` | A negative (`-∞ < x < 0`) `number` that is an integer. |
| `NonEmptyObject` | Represents an object with at least 1 non-optional key. |
| `NonEmptyString` | Matches any non-empty string. |
| `NonEmptyTuple` | Matches any non-empty tuple. |
| `NonNegative` | A non-negative `number`/`bigint` (`0 <= x < ∞`). |
| `NonNegativeInteger` | A non-negative (`0 <= x < ∞`) `number` that is an integer. |
| `NonNullableDeep` | Recursively removes `null` and `undefined` from the specified type. |
| `ObjectMerge` | Merge two object types into a new object type, where keys from the second override keys from the first. |
| `OmitDeep` | Omit properties from a deeply-nested object. |
| `OmitIndexSignature` | Omit any index signatures from the given object type, leaving only explicitly defined properties. |
| `Opaque` | Note: The `Opaque` type is deprecated in favor of `Tagged`. |
| `Optional` | Create a type that represents either the value or `undefined`, while stripping `null` from the type. |
| `OptionalKeysOf` | Extract all optional keys from the given type. |
| `Or` | Returns a boolean for whether either of two given types is `true`. |
| `OrAll` | Returns a boolean for whether any of the given elements is `true`. |
| `OverrideProperties` | Override existing properties of the given type. |
| `PackageJson` | Type for [npm's `package.json` file](https://docs.npmjs.com/creating-a-package-json-file). |
| `PartialDeep` | Create a deeply optional version of another type. |
| `PartialDeepOptions` | Configure the behavior of `PartialDeep`. |
| `PartialOnUndefinedDeep` | Create a deep version of another type where all keys accepting `undefined` type are set to optional. |
| `PartialOnUndefinedDeepOptions` | Configure the behavior of `PartialOnUndefinedDeep`. |
| `PascalCase` | Convert a string literal to pascal-case. |
| `PascalCasedProperties` | Convert top-level object properties to pascal case. |
| `PascalCasedPropertiesDeep` | Convert object properties to pascal case recursively. |
| `Paths` | Generate a union of all possible paths to properties in the given object. |
| `PathsOptions` | Paths options. |
| `PickDeep` | Pick properties from a deeply-nested object. |
| `PickIndexSignature` | Pick only index signatures from the given object type, leaving out all explicitly defined properties. |
| `PositiveInfinity` | Matches the hidden `Infinity` type. |
| `Primitive` | Matches any [primitive value](https://developer.mozilla.org/en-US/docs/Glossary/Primitive). |
| `Promisable` | Create a type that represents either the value or the value wrapped in `PromiseLike`. |
| `ReadonlyDeep` | Create a deeply immutable version of another type. |
| `ReadonlyKeysOf` | Extract all readonly keys from the given type. |
| `ReadonlyTuple` | Create a type that represents a read-only tuple of the given type and length. |
| `RemovePrefix` | Remove the specified prefix from the start of a string. |
| `RemovePrefixOptions` | Configure the behavior of `RemovePrefix`. |
| `RemoveSuffix` | Remove the specified suffix from the end of a string. |
| `RemoveSuffixOptions` | Configure the behavior of `RemoveSuffix`. |
| `RenameKeys` | Rename keys in an object type according to a map of old-to-new names. |
| `Replace` | Represents a string with some or all matches replaced by a replacement. |
| `ReplaceOptions` | Configure the behavior of `Replace`. |
| `RequireAllOrNone` | Create a type that requires all of the given keys or none of the given keys, while keeping the remaining keys as is. |
| `RequireAtLeastOne` | Create a type that requires at least one of the given keys, while keeping the remaining keys as is. |
| `RequiredDeep` | Create a deeply required version of another type. |
| `RequiredKeysOf` | Extract all required keys from the given type. |
| `RequireExactlyOne` | Create a type that requires exactly one of the given keys and disallows more, while keeping the remaining keys as is. |
| `RequireOneOrNone` | Create a type that requires exactly one of the given keys or none of the given keys, while keeping the remaining keys as is. |
| `Schema` | Create a deep version of another object type where property values are recursively replaced into a given value type. |
| `SchemaOptions` | Configure the behavior of `Schema`. |
| `ScreamingSnakeCase` | Convert a string literal to screaming-snake-case. |
| `SetFieldType` | Create a type that changes the type of the given keys. |
| `SetFieldTypeOptions` | Configure the behavior of `SetFieldType`. |
| `SetNonNullable` | Create a type that makes the given keys non-nullable, while keeping the remaining keys as is. |
| `SetNonNullableDeep` | Create a type that makes the specified keys non-nullable (removes `null` and `undefined`), supports deeply nested key paths, and leaves all other keys unchanged. |
| `SetOptional` | Create a type that makes the given keys optional, while keeping the remaining keys as is. |
| `SetParameterType` | Create a function that replaces some parameters with the given parameters. |
| `SetReadonly` | Create a type that makes the given keys readonly, while keeping the remaining keys as is. |
| `SetRequired` | Create a type that makes the given keys required, while keeping the remaining keys as is. |
| `SetRequiredDeep` | Create a type that makes the given keys required, with support for deeply nested key paths, while keeping the remaining keys as is. |
| `SetReturnType` | Create a function type with a return type of your choice and the same parameters as the given function type. |
| `SharedUnionFields` | Create a type with shared fields from a union of object types. |
| `SharedUnionFieldsDeep` | Create a type with shared fields from a union of object types, deeply traversing nested structures. |
| `SharedUnionFieldsDeepOptions` | SharedUnionFieldsDeep options. |
| `Simplify` | Useful to flatten the type output to improve type hints shown in editors. |
| `SimplifyDeep` | Deeply simplifies an object type. |
| `SingleKeyObject` | Create a type that only accepts an object with a single key. |
| `SnakeCase` | Convert a string literal to snake-case. |
| `SnakeCasedProperties` | Convert top-level object properties to snake case. |
| `SnakeCasedPropertiesDeep` | Convert object properties to snake case recursively. |
| `SomeExtend` | Returns a boolean for whether some element in an array type extends another type. |
| `SomeExtendOptions` | Configure the behavior of `SomeExtend`. |
| `Split` | Represents an array of strings split using a given character or character set. |
| `SplitOnRestElement` | Splits an array into three parts, where the first contains all elements before the rest element, the second is the [`rest`](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types) element itself, and the third contains all elements after the rest element. |
| `SplitOptions` | Split options. |
| `Spread` | Mimic the type inferred by TypeScript when merging two objects or two arrays/tuples using the spread syntax. |
| `Stringified` | Create a type with the keys of the given type changed to `string` type. |
| `StringLength` | Returns the length of the given string. |
| `StringRepeat` | Returns a new string which contains the specified number of copies of a given string, just like `String#repeat()`. |
| `StringSlice` | Returns a string slice of a given range, just like `String#slice()`. |
| `StringToArray` | Returns an array of the characters of the specified string. |
| `StringToArrayOptions` | Configure the behavior of `StringToArray`. |
| `StringToNumber` | Converts a numeric string to a number. |
| `StructuredCloneable` | Matches a value that can be losslessly cloned using `structuredClone`. |
| `Subtract` | Returns the difference between two numbers. |
| `Sum` | Returns the sum of two numbers. |
| `Tagged` | Create a [tagged type](https://medium.com/@KevinBGreene/surviving-the-typescript-ecosystem-branding-and-type-tagging-6cf6e516523d) that can support [multiple tags](https://github.com/sindresorhus/type-fest/issues/665) and [per-tag metadata](https://medium.com/@ethanresnick/advanced-typescript-tagged-types-improved-with-type-level-metadata-5072fc125fcf). |
| `TaggedUnion` | Create a union of types that share a common discriminant property. |
| `Trim` | Remove leading and trailing spaces from a string. |
| `TsConfigJson` | Type for [TypeScript's `tsconfig.json` file](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html). |
| `TupleOf` | Create a tuple type of the specified length with elements of the specified type. |
| `TupleToObject` | Transforms a tuple into an object, mapping each tuple index to its corresponding type as a key-value pair. |
| `TupleToUnion` | Convert a tuple/array into a union type of its elements. |
| `TypedArray` | Matches any [typed array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray), like `Uint8Array` or `Float64Array`. |
| `UndefinedOnPartialDeep` | Create a deep version of another type where all optional keys are set to also accept `undefined`. |
| `UnionLength` | Returns the length of a union type. |
| `UnionMax` | Returns the maximum number in a union of numbers. |
| `UnionMember` | Returns an arbitrary member of a union type. |
| `UnionToIntersection` | Convert a union type to an intersection type. |
| `UnionToTuple` | Convert a union type into an unordered tuple type of its elements. |
| `UnknownArray` | Represents an array with `unknown` value. |
| `UnknownMap` | Represents a map with `unknown` key and value. |
| `UnknownRecord` | Represents an object with `unknown` value. |
| `UnknownSet` | Represents a set with `unknown` value. |
| `UnwrapOpaque` | Note: The `UnwrapOpaque` type is deprecated in favor of `UnwrapTagged`. |
| `UnwrapPartial` | Revert the `Partial` modifier on an object type. |
| `UnwrapRequired` | Revert the `Required` modifier on an object type. |
| `UnwrapTagged` | Get the untagged portion of a tagged type created with `Tagged`. |
| `UppercaseLetter` | Matches any uppercase letter in the basic Latin alphabet (A-Z). |
| `ValueOf` | Create a union of the given object's values, and optionally specify which keys to get the values from. |
| `Words` | Split a string similar to Lodash's `_.words()` function. |
| `WordsOptions` | Words options. |
| `Writable` | Create a type that strips `readonly` from the given type. |
| `WritableDeep` | Create a deeply mutable version of an `object`/`ReadonlyMap`/`ReadonlySet`/`ReadonlyArray` type. |
| `WritableKeysOf` | Extract all writable keys from the given type. |
| `Xor` | Returns a boolean for whether only one of two given types is `true`. |

## `@total-typescript/ts-reset` — application-wide declarations

Import `@total-typescript/ts-reset` once in an app declaration file. Keep it out of published libraries because it changes global types for consumers.

## `zod` — schema validation

Validate and parse untrusted input; infer static types from schemas.

```ts
import { z } from "zod"

const User = z.object({ id: z.string(), email: z.email() })
type User = z.infer<typeof User>

const user = User.parse(await res.json()) // throws on mismatch
const result = User.safeParse(input) // { success, data | error }
```

Pass a Zod schema directly to TanStack Form, for example `validators: { onSubmit: User }`. Reuse the schema at the API
boundary when both inputs have the same contract.
