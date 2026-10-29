// Forked from Better Auth's db/type.ts and db/plugin.ts, so features declare tables the way Better Auth plugins do
// without depending on Better Auth. Attributes that only Better Auth's API layer reads are left out.

/** How a field is stored. A list of strings is an enum stored as a string. */
export type FieldType = "string" | "number" | "boolean" | "date" | "json" | "string[]" | "number[]" | readonly string[]

/** A value a field can hold. */
export type FieldValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | string[]
  | number[]
  | Record<string, unknown>
  | unknown[]

/** A field of a feature table. */
export interface FieldAttribute {
  type: FieldType
  /** Whether a new row needs a value. The default is `true`. */
  required?: boolean | undefined
  /** The value written when a new row has none. It isn't a database default. */
  defaultValue?: FieldValue | (() => FieldValue) | undefined
  /** The value written on every update that doesn't set the field. */
  onUpdate?: (() => FieldValue) | undefined
  /** Changes the value on its way into or out of the database. */
  transform?:
    | {
        input?: ((value: FieldValue) => FieldValue | Promise<FieldValue>) | undefined
        output?: ((value: FieldValue) => FieldValue | Promise<FieldValue>) | undefined
      }
    | undefined
  /** A field of another table this one references. Deleting the referenced row cascades unless `onDelete` says otherwise. */
  references?:
    | {
        model: string
        field: string
        onDelete?: "no action" | "restrict" | "cascade" | "set null" | "set default" | undefined
      }
    | undefined
  unique?: boolean | undefined
  /** Stores a number as a bigint instead of an integer. */
  bigint?: boolean | undefined
  /** The column name, when it differs from the field name. */
  fieldName?: string | undefined
  /** Stores a string as a varchar, so it can be sorted and indexed on every database. */
  sortable?: boolean | undefined
  index?: boolean | undefined
}

/** An index over one or more fields of a table. */
export interface TableIndex {
  /** One to sixteen field names, in index order. */
  fields: readonly [string, ...string[]]
  /** A portable index name of at most 63 UTF-8 bytes. */
  name?: string | undefined
  unique?: boolean | undefined
}

/** Tables a feature adds, keyed by logical model name. */
export type FeatureSchema = {
  [table: string]: {
    fields: Record<string, FieldAttribute>
    indexes?: readonly TableIndex[] | undefined
    /** The table name, when it differs from the model name. */
    modelName?: string | undefined
    /** Leaves the table out of generated schemas, for tables the app creates itself. */
    disableMigration?: boolean | undefined
  }
}

/** One table after every feature's declarations are merged. */
export interface TableSchema {
  modelName: string
  fields: Record<string, FieldAttribute>
  indexes?: readonly TableIndex[] | undefined
  disableMigrations?: boolean | undefined
}

/** Every table the enabled features declare, keyed by logical model name. */
export type DatabaseSchema = Record<string, TableSchema>
