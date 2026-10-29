// Vendored from Better Auth 1.7.14 (packages/cli/src/generators/types.ts). Do not edit. Run pnpm sync:better-auth instead.
import type { BetterAuthOptions } from "../../../../../../replacements/core.js";
import type { DBAdapter } from "../../../../../../replacements/adapter.js";

export interface SchemaGeneratorResult {
	code?: string;
	fileName: string;
	overwrite?: boolean;
	append?: boolean;
	/**
	 * Schema changes the generated code contains but no database can apply
	 * without corrupting the rows it already holds.
	 */
	unsafeChanges?: string[];
	/**
	 * Columns the database requires that Better Auth never writes. No generated
	 * migration removes them; each entry names the change that does.
	 */
	schemaProblems?: string[];
}

export interface SchemaGenerator {
	<Options extends BetterAuthOptions>(opts: {
		file?: string;
		adapter: DBAdapter;
		options: Options;
	}): Promise<SchemaGeneratorResult>;
}
