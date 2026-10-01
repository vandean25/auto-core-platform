# NestJS 12.1.0 Modernization Design

## Goal

Upgrade the `core-api` backend framework to NestJS 12.1.0, modernizing core framework dependencies and companion packages while enabling NestJS 12's new capabilities:
1. Native Standard Schema (Zod) validation alongside existing class-validator DTOs.
2. Route conflict diagnostics at bootstrap.
3. Observability telemetry integration via `@nestjs/observe`.
4. Full contract and test validation across OpenAPI, ESM, unit, and E2E suites.

## Context & Architecture

`apps/core-api` is already configured for native ESM (`"type": "module"`, `"moduleResolution": "nodenext"`, Node.js >= 22). NestJS 12 shifts framework packages to pure ESM and requires Node.js >= 20.19 / 22.12, making `core-api` exceptionally well suited for this migration.

### Scope & Dependencies

The following packages in `apps/core-api/package.json` are upgraded:

- Core framework:
  - `@nestjs/common`: `^11.2.1` -> `^12.1.0`
  - `@nestjs/core`: `^11.2.1` -> `^12.1.0`
  - `@nestjs/platform-express`: `^11.2.1` -> `^12.1.0`
  - `@nestjs/platform-socket.io`: `^11.2.1` -> `^12.1.0`
  - `@nestjs/websockets`: `^11.2.1` -> `^12.1.0`
  - `@nestjs/testing`: `^11.2.1` -> `^12.1.0`
- Companion packages:
  - `@nestjs/swagger`: `^11.4.4` -> `^12.0.2`
  - `@nestjs/jwt`: `^11.0.2` -> `^12.0.2`
  - `@nestjs/mapped-types`: `^2.1.1` -> `^12.0.0`
  - `@nestjs/schedule`: `^6.1.3` -> `^12.0.2`
  - `@nestjs/cli`: `^11.0.24` -> `^12.0.8`
  - `@nestjs/schematics`: `^11.1.0` -> `^12.0.6`
- Observability:
  - `@nestjs/observe`: `^0.3.5`
- Maintained as compatible:
  - `@nestjs/event-emitter`: `^12.0.1` (already compatible)
  - `@nestjs/throttler`: `^6.7.1` (peerDeps support NestJS 12)

### Standard Schema & Validation Architecture

- **Backward Compatibility**: Existing controllers and DTOs using `class-validator` and `class-transformer` remain untouched and governed by the global `ValidationPipe`.
- **Standard Schema Integration**: Support NestJS 12's native Standard Schema pipeline (`StandardSchemaValidationPipe`) so route decorators (`@Body({ schema: ... })`, `@Query({ schema: ... })`, `@Param({ schema: ... })`) validate Zod schemas with direct type inference.
- **OpenAPI Integration**: Register the Swagger Standard Schema converter in `generate-openapi.ts` and `src/main.ts` so Zod schemas automatically emit corresponding OpenAPI 3.1 definitions into `openapi.json`.
- **Reference Implementation**: Implement an example/pilot endpoint or test fixture exercising native Zod validation, parameter transformation, and formatted error responses.

### Observability & Diagnostics

- NestJS 12 route conflict analysis runs during bootstrap to catch shadowed dynamic paths.
- `@nestjs/observe` APM integration provides runtime diagnostic metrics and telemetry without interfering with existing `@sentry/node` error-reporting.

### Verification & Quality Gates

- `npm run check:esm --workspace=core-api`
- `npm run build --workspace=core-api`
- `npm run openapi:generate --workspace=core-api`
- `npm run api:types:generate --workspace=core-web`
- `npm test --workspace=core-api -- --ci --runInBand`
- `DATABASE_URL="..." npm run test:e2e --workspace=core-api -- --ci --runInBand`
