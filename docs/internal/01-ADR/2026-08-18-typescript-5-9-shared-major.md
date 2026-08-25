---
title: "ADR-0017: Shared TypeScript 7 Compiler With TS 6 Tooling Shim"
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

# ADR-0017: Shared TypeScript 7 Compiler With TS 6 Tooling Shim

## Status

**Accepted** — 2026-08-18 (original 5.9 pin)  
**Amended** — 2026-08-25 (TypeScript 7 side-by-side migration)

## Context

`apps/core-api` and `apps/core-web` previously pinned TypeScript **5.9** so OpenAPI-generated types, IDE services, ESLint parsers, and Nest tooling agreed on one compiler major.

TypeScript **7.0** ships a native Go compiler (`tsc` 7.x) but removes the programmatic compiler API that `typescript-eslint`, `ts-node`, and Nest bootstrap scripts still require. A naive Dependabot bump to `typescript@7` therefore breaks lint, OpenAPI generation, and CI.

Microsoft’s recommended interim approach is to run **TypeScript 7 for compilation** and keep a **TypeScript 6 API shim** for ecosystem tools until TS 7.1 exposes a stable programmatic API ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)).

## Decision Drivers

* One compiler major for `tsc` type-checking and emit in both apps.
* `typescript-eslint@8.x` peer range remains `>=4.8.4 <6.1.0` — must resolve `typescript` to the TS 6 shim.
* Nest/OpenAPI scripts need `emitDecoratorMetadata`; `tsx` alone is insufficient — keep `ts-node` on the TS 6 shim for those entrypoints.
* Simpler utility scripts can use `tsx` (no programmatic API).

## Decision

Adopt Microsoft’s side-by-side layout at the workspace root:

| Package | npm alias | Role |
|---------|-----------|------|
| `@typescript/native` | `npm:typescript@~7.0.2` | **Primary compiler** — `tsc` on PATH is 7.0.2 |
| `typescript` | `npm:@typescript/typescript6@^6.0.2` | **Tooling shim** — satisfies `typescript-eslint`, `ts-node`, `ts-jest` peers; exposes `tsc6` |

**Build commands**

* `apps/core-api`: `tsc -p tsconfig.build.json` (TS 7)
* `apps/core-web`: `tsc -b && vite build` (TS 7 typecheck)

**Script runners**

* Nest/OpenAPI/Prisma seed: `ts-node -r tsconfig-paths/register` (TS 6 shim)
* Standalone scripts (lint, GCS, seeds helpers): `tsx`

**TS 7 config hygiene**

* Remove deprecated `baseUrl` from `tsconfig` paths (TS 7); paths remain relative to the config file.

Do **not** merge raw Dependabot major bumps of `typescript` to 7.x without this shim layout.

**Architectural Components Affected:**

* Root `package.json` devDependencies and `overrides`
* `apps/core-api` / `apps/core-web` build scripts
* `cloudbuild*.yaml` migration helpers (`tsx`)
* ESLint in both apps (unchanged config; uses TS 6 shim via peer resolution)

**Interface Changes:**

* None at runtime.

## Consequences

### Positive

- TS 7 native compiler speed and language semantics for `tsc` builds in both apps.
- ESLint and Jest keep working via the TS 6 shim without forking parser config.
- OpenAPI generation and Prisma seeding remain stable on `ts-node`.

### Negative

- Two TypeScript packages in the tree until TS 7.1 stabilizes the programmatic API.
- `nest build` is replaced by direct `tsc` emit — Nest CLI watch/dev still bundles its own TS 5.9 for scaffolding only.
- Agents and docs must distinguish `tsc` (7) vs `tsc6` (6 shim).

### Neutral

- Patch/minor updates within `~7.0.2` and `^6.0.2` ranges remain allowed.
- Revisit when `typescript-eslint` documents first-class TS 7 support (tracked: [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| TS 7 compile + TS 6 shim (chosen) | Official migration path; lint/tests keep working | Dual package until 7.1 API |
| Pin both apps to TS 5.9 | Smallest change | Misses TS 7; Nest/eslint already diverged from 5.9 |
| Force `typescript@7` everywhere | Single dependency | Breaks eslint, ts-node, ts-jest (PR #393) |

## Implementation Strategy

### Blast Radius

**Impact Scope**: Dev tooling only.

**Affected Components**:

- Root lockfile and overrides
- Build scripts in `apps/core-api`, `apps/core-web`
- `cloudbuild.yaml`, `cloudbuild.staging.yaml`
- ADR-0017 (this document), `agents.md`

**Risk Mitigation**:

- Run full PR Build Check workflow locally: lint, `tsc` build, unit tests, OpenAPI contract.
- Keep Dependabot `ignore` on `typescript` semver-major until TS 7.1 ecosystem lands.

### Reversibility

**Reversibility Level**: High — restore prior `package.json` / lockfile pins.

## Pragmatic Enforcer Analysis

- **Necessity**: High — TS 7 is the supported compile target; naive bumps break CI.
- **Complexity**: Medium — alias layout + script runner split.
- **Recommendation**: Approve side-by-side now; collapse to single `typescript@7` when eslint/ts-node support lands.

## References

- [TypeScript 7.0 announcement — side-by-side with TS 6](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)
- PR #393 (closed — naive TS 7 bump)
- `typescript-eslint` TS 7 tracking: [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Maintenance](https://linear.app/auto-core-platform/project/maintenance-cd2557464590) |
| Milestone | P2 — Consistency and DX |
| Issues | AUT-141 |
