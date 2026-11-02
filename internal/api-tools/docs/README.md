# API tooling

This private workspace runs Microsoft API Extractor against compiled declarations. Configuration is shared and public
entry points are discovered from workspace manifests. [API report workflow](../../../api-reports/README.md).

The extractor uses its own supported TypeScript compiler to read declarations. Package compilation continues to use the
repository's native TypeScript version. It does not bundle or rewrite shipped declarations.

Redux Toolkit ships `dist/uncheckedindexed.ts` behind a declaration import. The extractor analyzes it normally; only
that exact dependency file's wrong-input-extension notice is informational. The same warning for our files still fails
checks. Missing prose remains visible as `(undocumented)` in API reports without blocking initial adoption.
