// Stands in for `better-auth/adapters` and `@better-auth/core/db/adapter` in vendored code.
export { initGetFieldName } from "../vendor/better-auth/packages/core/src/db/adapter/get-field-name.js"
export { initGetModelName } from "../vendor/better-auth/packages/core/src/db/adapter/get-model-name.js"

/** What the generators read from an adapter: its name, and the configuration it was created with. */
export interface DBAdapter {
  id: string
  options?:
    | {
        provider?: "pg" | "mysql" | "sqlite" | undefined
        schemaName?: string | undefined
        camelCase?: boolean | undefined
        adapterConfig?: { usePlural?: boolean | undefined } | undefined
      }
    | undefined
}
