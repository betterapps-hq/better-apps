// The Standard Schema interface (https://standardschema.dev, MIT), written out here as the specification suggests, so
// actions accept zod, Valibot, ArkType and any other validator that implements it without depending on one.

/** A validator that implements Standard Schema, such as a zod, Valibot or ArkType schema. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaProps<Input, Output>
}

/** The properties every Standard Schema validator exposes. */
export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  readonly types?: { readonly input: Input; readonly output: Output } | undefined
}

/** A validated value, or the reasons the value isn't valid. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] }

/** One reason a value isn't valid. */
export interface StandardSchemaIssue {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

/** The value a schema accepts. */
export type InferSchemaInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"]

/** The value a schema returns once it's valid. */
export type InferSchemaOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"]
