---
title: "ADR-0010: OpenAPI Contract-First Development"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Engineering Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - api
  - contract
  - ci
  - codegen
---

# ADR-0010: OpenAPI Contract-First Development

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

Auto Core Platform has a NestJS backend (`apps/core-api`) and a React frontend (`apps/core-web`) that communicate exclusively via a REST API. As the system grew, we encountered recurring problems:

1. **Type drift:** Frontend developers manually duplicated backend DTOs into TypeScript interfaces. When backend shapes changed, frontend types silently became stale, causing runtime errors that only surfaced in production.
2. **Undocumented endpoints:** New API routes were added without updating any shared contract, making it difficult for frontend developers to discover available endpoints.
3. **Review friction:** PR reviewers had no single artifact to verify that backend and frontend agreed on the API shape.

We needed a single source of truth for the API contract that both backend and frontend could depend on, with automated enforcement to prevent drift.

## Decision

We adopt **OpenAPI as the authoritative API contract**, with generated frontend types and CI enforcement of contract synchronization.

### Architecture

```
┌─────────────────────┐
│  NestJS Controllers  │  Swagger decorators (@ApiProperty, @ApiResponse, etc.)
│  + DTOs with         │  define the contract at the source.
│  class-validator     │
└────────┬────────────┘
         │  npm run openapi:generate
         ▼
┌─────────────────────┐
│  openapi.json        │  apps/core-api/openapi/openapi.json
│  (Generated artifact)│  Committed to version control.
└────────┬────────────┘
         │  npm run api:types:generate
         ▼
┌─────────────────────┐
│  openapi.ts          │  apps/core-web/src/api/generated/openapi.ts
│  (Generated types)   │  Committed to version control.
└─────────────────────┘
```

### Contract Flow

1. **Backend is the source:** NestJS controllers and DTOs decorated with `@nestjs/swagger` decorators define the API shape. `class-validator` decorators provide both runtime validation and schema metadata.
2. **OpenAPI spec is generated:** Running `npm --prefix apps/core-api run openapi:generate` produces `apps/core-api/openapi/openapi.json` from the live NestJS application.
3. **Frontend types are generated:** Running `npm --prefix apps/core-web run api:types:generate` reads `openapi.json` and produces TypeScript types in `apps/core-web/src/api/generated/openapi.ts`.
4. **Both artifacts are committed:** `openapi.json` and `openapi.ts` are checked into version control so that any drift is visible in pull request diffs.

### Mandatory Regeneration Workflow

Whenever a developer modifies any of the following, they **must** regenerate both artifacts before committing:

| Change Type | Examples |
|-------------|----------|
| Controller route | New endpoint, changed path, changed HTTP method |
| Request DTO | New field, removed field, changed type, changed validation |
| Response DTO | New field, removed field, changed shape |
| Swagger decorator | `@ApiProperty`, `@ApiResponse`, `@ApiTags`, `@ApiQuery` |
| Enum used in API | New enum value, renamed value |

**Regeneration commands (in order):**

```bash
npm --prefix apps/core-api run openapi:generate
npm --prefix apps/core-web run api:types:generate
```

### CI Enforcement

The PR workflow includes a contract drift check that:

1. Regenerates `openapi.json` from the PR's backend code.
2. Regenerates `openapi.ts` from the regenerated `openapi.json`.
3. Compares both against the committed versions.
4. **Fails the build** if any difference is detected.

This ensures that no PR can merge with stale contract artifacts, even if the developer forgot to regenerate locally.

### Frontend Usage Rules

- **Import generated types, never duplicate DTOs manually.**
  ```typescript
  // ✅ Correct — use generated types
  import type { components } from '@/api/generated/openapi'
  type Invoice = components['schemas']['InvoiceDto']

  // ❌ Wrong — manual duplication
  interface Invoice { id: string; status: string; /* ... */ }
  ```
- **TanStack Query hooks** in `src/api/` consume these generated types for request/response typing.
- **If a type doesn't exist in the generated file,** the backend DTO is missing Swagger decorators — fix the backend, don't create a manual type.

### Feature Spec Integration

Every Feature Spec that introduces or modifies API endpoints must include an **OpenAPI Regeneration** checklist (per the Feature Spec template):

```markdown
### OpenAPI Regeneration
- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`
```

## Consequences

### Positive

- **Single source of truth:** Backend DTOs are the canonical definition. Frontend types are always derived, never invented.
- **Automated drift detection:** CI catches contract mismatches before merge, eliminating an entire class of runtime errors.
- **Self-documenting API:** The `openapi.json` file serves as living documentation — can be rendered with Swagger UI, Redoc, or imported into Postman.
- **Type safety end-to-end:** Generated TypeScript types give the frontend compile-time guarantees about API shapes.

### Negative

- **Regeneration friction:** Developers must remember to run two commands after backend changes. Forgetting causes CI failures (by design, but it slows iteration).
- **Generated file noise in PRs:** Large regenerated diffs can obscure the actual code changes in a PR. Reviewers must learn to skim generated files.
- **Swagger decorator burden:** Every DTO property needs `@ApiProperty()` for complete schema generation. Missing decorators produce incomplete types.

### Neutral

- The generated `openapi.ts` file can be large. It is a single file by design — splitting it would complicate the generation pipeline without meaningful benefit.
- We do not currently use OpenAPI for request validation on the frontend (validation is handled by `class-validator` on the backend). This could be added later with libraries like `zod` schemas generated from OpenAPI.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Manual TypeScript interfaces on frontend** | No tooling setup, developer familiarity | Drift is inevitable, no enforcement, duplicated maintenance |
| **GraphQL** | Typed by design, client generates types from schema | Major migration cost, NestJS REST is already established, over-engineering for our use case |
| **tRPC** | End-to-end type safety without code generation | Requires shared TypeScript monorepo (we have separate apps), NestJS integration is immature |
| **Shared npm package with DTOs** | Types defined once, consumed by both apps | Build/publish overhead, versioning complexity, doesn't capture endpoint shapes (only data shapes) |
| **Schema-first OpenAPI (write spec manually, generate backend)** | Spec is always intentional, not accidentally generated | Inverts our workflow — backend would need to conform to a handwritten spec, losing the convenience of NestJS decorators |

## References

- ADR-0008: Automated Architectural Governance — CI enforcement of contract drift is one governance check
- Feature Spec template: `docs/internal/templates/Feature Spec.md` — includes OpenAPI Regeneration checklist
- NestJS Swagger documentation: `@nestjs/swagger` module
- `apps/core-api/openapi/openapi.json` — the generated contract artifact
- `apps/core-web/src/api/generated/openapi.ts` — the generated frontend types

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | Retroactive ADR |
