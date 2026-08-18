---
title: "ADR-0017: Shared TypeScript 5.9 Major Across core-api and core-web"
date: "2026-08-18"
status: accepted
deciders: "Engineering Team"
linear-project: "https://linear.app/auto-core-platform/project/maintenance-cd2557464590"
linear-milestone: "P2 — Consistency and DX"
tags:
  - adr
  - typescript
  - dx
  - tooling
---

# ADR-0017: Shared TypeScript 5.9 Major Across core-api and core-web

## Status

**Accepted** — 2026-08-18

## Context

`apps/core-api` locked TypeScript **6.0.3** while `apps/core-web` locked **5.9.3**. Shared OpenAPI-generated types, IDE language services, ESLint parsers, and agent skills therefore compiled the same contract under two majors.

That split is a DX and correctness problem: a type that is legal in one app can fail `tsc` in the other, and `typescript-eslint` peer ranges and Nest CLI’s bundled compiler disagree with the API app’s declared compiler.

## Decision Drivers

* One language-service major for generated OpenAPI types consumed by both apps.
* NestJS CLI 11 still vendors TypeScript **5.9.3**; the Nest/ecosystem path to TS 6 is not clearly ready.
* Prefer a documented hold on 5.9 over an unproven bump of Vite/eslint/web to 6.
* Keep `typescript-eslint` on the 8.x line that already supports `>=4.8.4 <6.1.0`.

## Decision

Both `apps/core-api` and `apps/core-web` pin **TypeScript 5.9** (`~5.9.3`) and **typescript-eslint 8.60.0**. Do not adopt TypeScript 6 until Nest CLI, Vite, and eslint are proven on that major in this repo.

**Architectural Components Affected:**

* `apps/core-api` compiler and Nest build
* `apps/core-web` `tsc -b` / Vite build
* ESLint type-aware rules in both apps
* Agent guidance in `agents.md`

**Interface Changes:**

* None at runtime. DevDependency versions and lockfiles change only.

## Consequences

### Positive

- Shared OpenAPI types typecheck under one compiler major.
- IDE, CI, and agent skills agree on the language version.
- Aligns with Nest CLI’s bundled TypeScript 5.9.3.

### Negative

- API does not yet use TypeScript 6 language features or stricter defaults.
- A later TS 6 migration will need a follow-up ADR with Vite/eslint evidence.

### Neutral

- Patch releases within 5.9 remain allowed via the `~5.9.3` range.
- `typescript-eslint` is pinned to 8.60.0 on both apps (web was 8.59.4).

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Pin both apps to TypeScript 5.9 (chosen) | Matches Nest CLI; smallest blast radius; issue default | Defers TS 6 until the ecosystem is ready |
| Bump core-web to TypeScript 6 | Newer compiler everywhere | Nest CLI still vendors 5.9.3; Vite/eslint not proven here; larger `tsc` risk |
| Leave majors split | No immediate lockfile churn | OpenAPI types, IDE, and agents keep disagreeing |

## Implementation Strategy

### Blast Radius

**Impact Scope**: Dev tooling only. Production JS output should be unchanged aside from compiler version.

**Affected Components**:

- `apps/core-api` — `typescript` 6.0.3 → 5.9.3; `npm run build` (`nest build`)
- `apps/core-web` — `typescript-eslint` 8.59.4 → 8.60.0; existing `~5.9.3`
- Lockfiles for both apps

**User Impact**: None.

**Risk Mitigation**:

- Run `npm --prefix apps/core-api run build` and `npm --prefix apps/core-web run build`.
- Fix any new `tsc` errors with minimal source changes.

### Reversibility

**Reversibility Level**: High

**Rollback Feasibility**: Restore previous `package.json` / lockfile versions. No schema or API contract change.

## Pragmatic Enforcer Analysis

- **Necessity**: High — two majors on one generated type contract is active DX debt (AUT-141).
- **Complexity**: Low — version pin + ADR; no new abstraction.
- **Simpler alternative**: Leaving the split is simpler today and worse tomorrow. Bumping web to TS 6 is more complex without Nest evidence.
- **Recommendation**: Approve. Hold 5.9 until Nest CLI stops vendoring 5.9 and Vite/eslint builds are proven on 6.
- **Pragmatic score**: Necessity 8 / Complexity 2 / Ratio 0.25 (target < 1.5)

## References

- AUT-141
- Nest CLI 11 dependency on TypeScript 5.9.3
- `typescript-eslint` 8.x peer range `>=4.8.4 <6.1.0`

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Maintenance](https://linear.app/auto-core-platform/project/maintenance-cd2557464590) |
| Milestone | P2 — Consistency and DX |
| Issues | AUT-141 |
