# Core API ESM follow-up implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for task execution.

## Goal

Complete the approved, applicable ESM improvements for the private NestJS application: remove remaining CommonJS-era runtime/script patterns, add regression guardrails for native ESM, and verify/document the production ESM artifact. Do not add bundling, artificial top-level await, or public dual-package exports.

## Architecture and constraints

- Keep the existing NodeNext TypeScript and `type: module` package configuration.
- Preserve decorator metadata requirements for Nest/OpenAPI/Prisma scripts.
- Keep generated OpenAPI and frontend API artifacts semantically unchanged unless contract generation requires a deterministic update.
- Use explicit `.js` extensions for relative runtime imports.
- Keep changes limited to `apps/core-api`, its CI scripts, and focused documentation.

## Tasks

### 1. Finish ESM-native runtime and script paths

Files: remaining core-api source/scripts/tests identified by `rg` plus `apps/core-api/package.json` only where scripts need normalization.

1. Add or update focused tests that expose remaining `__dirname`, `__filename`, `require`, `require.main`, or ad-hoc URL conversion patterns.
2. Replace those patterns with `import.meta.dirname`, `import.meta.filename`, or a small shared ESM-safe helper where Node support requires it.
3. Normalize direct-entry guards and script runners while preserving Nest decorator metadata and existing CLI behavior.
4. Run the focused tests, then the core-api lint/build/unit checks.

### 2. Add ESM regression guardrails

Files: a focused checker under `apps/core-api/scripts/`, its test, `apps/core-api/package.json`, and the relevant CI workflow.

1. Write tests for extensionless relative imports and runtime CommonJS usage, including allowed generated/vendor/config cases.
2. Implement a deterministic repository checker that scans only maintained core-api runtime files and fails with actionable paths/lines.
3. Add an npm script and CI invocation without changing generated contract content.
4. Run the checker and its tests, then the affected CI-equivalent checks.

### 3. Verify and document the production ESM artifact

Files: production verification script/test and core-api ESM documentation (README or architecture docs).

1. Add a test covering the expected `dist/main.js` ESM shape and absence of unresolved relative imports in emitted files.
2. Implement a production artifact verifier that runs after build and reports actionable failures.
3. Document the runtime contract, supported script entry points, and the deliberate non-goals.
4. Run the verifier against a fresh build and all final required checks.

## Final verification and delivery

- Run backend Prisma generation, tenant lint, lint, build, unit tests, migration deploy, and serial fresh-database E2E tests.
- Run frontend lint, build, unit tests, frontend E2E, and API type drift checks.
- Review the diff, commit the implementation, create a draft PR with `gh`, wait for all checks, mark ready, and squash-merge only after every required check succeeds.
