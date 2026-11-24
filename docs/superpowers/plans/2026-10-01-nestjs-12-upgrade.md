# NestJS 12.1.0 Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `apps/core-api` to NestJS 12.1.0 and enable its key features including native Standard Schema (Zod) validation, route conflict diagnostics, and observability telemetry.

**Architecture:** Incrementally bump core framework and companion dependencies to their compatible NestJS 12 releases, enable native Standard Schema pipeline support alongside existing class-validator DTOs, hook into route diagnostics and `@nestjs/observe` telemetry, and verify contract stability across OpenAPI, ESM, unit, and E2E test suites.

**Tech Stack:** NestJS 12.1.0, Express, Socket.IO, Zod 4, `@nestjs/swagger` 12, `@nestjs/observe`, Prisma 7, Jest, TypeScript, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-01-nestjs-12-upgrade-design.md`

## Global Constraints

- Do not break or modify existing `class-validator` DTOs or OpenAPI schemas across core modules.
- Preserve ESM configuration (`type: module`, `NodeNext` resolution, explicit `.js` import extensions).
- All changes must pass OpenAPI generation, frontend type synchronization, and backend unit/E2E test suites.

---

### Task 1: Package Dependencies Upgrade & Lockfile Update

**Files:**
- Modify: `apps/core-api/package.json:43-100`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: Updated dependency tree resolving NestJS 12.1.0 ecosystem.

- [ ] **Step 1: Update dependencies in `apps/core-api/package.json`**
  Bump `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/platform-socket.io`, `@nestjs/websockets`, `@nestjs/testing` to `^12.1.0`. Bump `@nestjs/swagger` to `^12.0.2`, `@nestjs/jwt` to `^12.0.2`, `@nestjs/mapped-types` to `^12.0.0`, `@nestjs/schedule` to `^12.0.2`, `@nestjs/cli` to `^12.0.8`, `@nestjs/schematics` to `^12.0.6`. Add `@nestjs/observe` `^0.3.5`.
- [ ] **Step 2: Run `npm install`**
  Run `npm install` from repo root to update `package-lock.json` and resolve packages.
- [ ] **Step 3: Verify ESM contract and build**
  Run `npm run check:esm --workspace=core-api` and `npm run build --workspace=core-api`.
- [ ] **Step 4: Commit dependency update**
  Commit as `chore(deps): upgrade core-api to nestjs 12.1.0 and companion packages`.

---

### Task 2: Native Standard Schema (Zod) Validation Setup & Route Diagnostics

**Files:**
- Modify: `apps/core-api/src/main.ts`
- Modify: `apps/core-api/scripts/generate-openapi.ts`

**Interfaces:**
- Consumes: NestJS 12 `@nestjs/common` and `@nestjs/swagger` exports.
- Produces: Dual validation support for Standard Schema (Zod) and class-validator DTOs, plus Swagger OpenAPI reflection.

- [ ] **Step 1: Configure StandardSchemaValidationPipe in `main.ts`**
  Ensure the app pipeline accommodates both `ValidationPipe` (for existing class-validator DTOs) and native Standard Schema validation for routes with schema definitions.
- [ ] **Step 2: Register Swagger standard schema converter**
  In `scripts/generate-openapi.ts` and `src/main.ts`, configure `standardSchemaConverter` so any schema-based routes emit accurate OpenAPI definitions.
- [ ] **Step 3: Validate route conflict diagnostics**
  Verify bootstrap diagnostics report no route shadowing issues across controllers.
- [ ] **Step 4: Commit configuration updates**
  Commit as `feat(core-api): configure standard schema validation and swagger converter for nestjs 12`.

---

### Task 3: Pilot Standard Schema Endpoint & Test Suite

**Files:**
- Create: `apps/core-api/test/standard-schema-validation.e2e-spec.ts` (or unit test `apps/core-api/src/common/validation/standard-schema.spec.ts`)
- Modify: `apps/core-api/src/app.controller.ts` or diagnostic controller

**Interfaces:**
- Consumes: Zod schema definition via Standard Schema.
- Produces: Verified endpoint demonstrating Zod schema validation under NestJS 12.

- [ ] **Step 1: Write failing test for Standard Schema endpoint**
  Write a test asserting that a route accepting a Zod schema validates correct payloads and returns 400 Bad Request with structured issues for invalid inputs.
- [ ] **Step 2: Run test to confirm it fails**
  Run `npx jest test/standard-schema-validation.e2e-spec.ts` to verify failure.
- [ ] **Step 3: Implement endpoint with Zod schema**
  Add the controller endpoint utilizing `@Body({ schema })` / Standard Schema.
- [ ] **Step 4: Run test to verify it passes**
  Run test again to verify green status.
- [ ] **Step 5: Commit pilot implementation**
  Commit as `feat(core-api): add pilot endpoint demonstrating native zod standard schema validation`.

---

### Task 4: Observability & Diagnostics Integration (`@nestjs/observe`)

**Files:**
- Modify: `apps/core-api/src/app.module.ts` or `apps/core-api/src/common/observability/`
- Test: `apps/core-api/src/common/observability/observability.spec.ts`

**Interfaces:**
- Consumes: `@nestjs/observe`
- Produces: Integrated APM runtime metrics hook.

- [ ] **Step 1: Write test for observability module initialization**
  Write unit test verifying telemetry/metrics initialization without throwing.
- [ ] **Step 2: Configure `@nestjs/observe` in module tree**
  Import and configure the module with safe defaults for cloud deployment.
- [ ] **Step 3: Run unit tests**
  Verify all observability tests pass cleanly.
- [ ] **Step 4: Commit observability integration**
  Commit as `feat(core-api): integrate nestjs 12 observability module`.

---

### Task 5: Contract Drift Verification & Full CI Suite Execution

**Files:**
- Modify (if drift detected): `apps/core-api/openapi/openapi.json`
- Modify (if drift detected): `apps/core-web/src/api/generated/openapi.ts`

**Interfaces:**
- Consumes: Backend controller and route metadata.
- Produces: Validated, synchronized OpenAPI contracts and test verification.

- [ ] **Step 1: Regenerate OpenAPI specification**
  Run `npm run openapi:generate --workspace=core-api`.
- [ ] **Step 2: Regenerate frontend types**
  Run `npm run api:types:generate --workspace=core-web` and `npm run api:types:check --workspace=core-web`.
- [ ] **Step 3: Run backend linters**
  Run `npm run lint:prisma-tenant --workspace=core-api` and `npm run lint --workspace=core-api`.
- [ ] **Step 4: Run backend unit tests**
  Run `npm test --workspace=core-api -- --ci --runInBand`.
- [ ] **Step 5: Run backend E2E tests**
  Run `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" npm run test:e2e --workspace=core-api -- --ci --runInBand`.
- [ ] **Step 6: Commit contract updates and final verification**
  Commit any contract artifacts and verify git status is clean.
