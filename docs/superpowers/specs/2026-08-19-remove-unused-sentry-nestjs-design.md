# Remove Unused Sentry NestJS Integration

## Context

The API imports `src/instrument.ts` from `src/main.ts`. That file initializes
`@sentry/node` once when `SENTRY_DSN` is configured and enables Prisma
instrumentation. The codebase has no import or registration for
`@sentry/nestjs` or `SentryModule`; exception reporting is already handled by
the existing `@sentry/node` path.

## Decision

Remove `@sentry/nestjs` from `apps/core-api/package.json` and regenerate the
root lockfile with npm. Keep `@sentry/node`, `src/instrument.ts`, and the
existing exception filter unchanged. This leaves one Sentry integration path
and avoids adding a second initializer.

## Verification

Confirm there are no remaining `@sentry/nestjs` references, then run:

```bash
npm --prefix apps/core-api run build
npm --prefix apps/core-api test -- --runInBand
```

Also inspect the final diff to ensure the change is limited to dependency
metadata and that `@sentry/node` remains installed.
