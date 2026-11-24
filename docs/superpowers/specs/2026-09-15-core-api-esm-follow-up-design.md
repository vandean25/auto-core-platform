# Core API ESM Follow-up Design

## Goal

Complete the applicable benefits of the native ESM migration in `apps/core-api` without introducing a bundler, unnecessary top-level `await`, or library-only package machinery that does not benefit this private deployable application.

## Outcomes

1. Runtime and maintenance code use ESM-native APIs consistently.
2. Directly executed TypeScript scripts use one documented, ESM-safe execution path.
3. Package metadata and build artifacts describe the deployable as native ESM.
4. Automated checks prevent regressions to extensionless relative imports and CommonJS-only patterns.
5. ESM behavior is covered by focused tests, including direct script entry behavior.

## Design

### Runtime and scripts

- Inventory remaining `require`, `require.main`, `__dirname`, and `__filename` usage in `apps/core-api` and replace applicable cases with `import`, `import.meta.dirname`, or `fileURLToPath(import.meta.url)` where compatibility requires it.
- Standardize direct TypeScript execution on the smallest ESM-compatible runner that preserves Nest decorator metadata; retain `tsx` only for scripts that do not need metadata and use the `ts-node` ESM loader for OpenAPI/Prisma entry points.
- Normalize direct-entry guards around a reusable ESM-safe pattern and test them without executing imported modules as side effects.

### Package and build boundary

- Keep `type: module`, NodeNext resolution, and explicit `.js` relative specifiers as the source-of-truth configuration.
- Add package-level metadata that is useful for the production artifact, while avoiding a public `exports` map because `core-api` is not published as a library.
- Verify `dist/main.js` starts as ESM and that production invocation does not depend on ts-node or tsx.

### Guardrails

- Add targeted static checks for extensionless relative imports and runtime CommonJS APIs in backend source/scripts.
- Keep generated OpenAPI and frontend API types unchanged unless semantic contract drift is detected.
- Document the ESM execution contract near the backend scripts so future dependency updates preserve it.

### Explicit non-goals

- No backend bundling or tree-shaking experiment; Nest reflection, Prisma, and deployment diagnostics make the cost/risk disproportionate for this service.
- No artificial use of top-level `await`; it will be used only if an existing startup boundary benefits from asynchronous module initialization.
- No public-library conditional exports or dual CJS/ESM distribution.

## Testing and acceptance

- Backend unit tests, lint, Prisma tenant lint, build, and OpenAPI generation pass.
- Backend E2E tests pass against the fresh CI database.
- Frontend contract drift, lint, build, unit, and Playwright checks pass.
- New ESM guard tests fail before the corresponding guard is implemented and pass afterward.
- A production build can be invoked with `node dist/main.js` and contains no unresolved extensionless internal imports.

## Risks and mitigations

- ESM can retain more Jest module state and increase memory use; retain the verified E2E heap setting and monitor CI runtime.
- Nest decorator metadata can be lost under some TypeScript runners; keep metadata-sensitive scripts on the verified ts-node ESM path and test OpenAPI generation in CI.
- Mechanical import changes can create broad diffs; constrain edits to backend scope and use contract/build/test gates to detect accidental behavior changes.
