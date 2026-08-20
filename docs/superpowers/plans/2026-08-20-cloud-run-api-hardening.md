# Cloud Run API Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove retired API-key deployment wiring and add shared CORS handling, production-only Helmet headers, and IP-based auth-route throttling without limiting CRUD routes.

**Architecture:** Extract the gateway's origin parser into a shared HTTP helper used by both bootstrap and Socket.IO. Configure Express proxy trust, CORS, and production-only Helmet in a focused bootstrap helper. Register Nest Throttler as the first global guard, skip every route except the two auth paths, and override their limits with method-specific `@Throttle` metadata before `JwtAuthGuard` runs.

**Tech Stack:** NestJS 11, Express, `@nestjs/throttler`, Helmet, Jest, Supertest, TypeScript, Cloud Build YAML.

---

### Task 1: Add the shared CORS resolver

**Files:**
- Create: `apps/core-api/src/common/http/cors-origins.ts`
- Create: `apps/core-api/src/common/http/cors-origins.spec.ts`
- Modify: `apps/core-api/src/dashboard-realtime/dashboard.gateway.ts`
- Modify: `apps/core-api/src/dashboard-realtime/dashboard.gateway.spec.ts`

- [ ] **Step 1: Write the failing shared-helper tests**

Create `cors-origins.spec.ts` with tests for the comma-separated input and production failure:

```typescript
import { resolveCorsOrigins } from './cors-origins';

describe('resolveCorsOrigins', () => {
  it('splits, trims, and removes empty configured origins', () => {
    expect(
      resolveCorsOrigins(' https://app.example.com, ,http://localhost:5173 ', 'test'),
    ).toEqual(['https://app.example.com', 'http://localhost:5173']);
  });

  it('uses local development origins outside production when unset', () => {
    expect(resolveCorsOrigins(undefined, 'development')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('fails closed in production when no usable origin exists', () => {
    expect(() => resolveCorsOrigins(' , ', 'production')).toThrow(
      /without FRONTEND_URL/,
    );
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/common/http/cors-origins.spec.ts
```

Expected: FAIL because `cors-origins.ts` does not exist.

- [ ] **Step 3: Implement the shared resolver**

Create the helper with the gateway's existing defaults and production error:

```typescript
import { Logger } from '@nestjs/common';

const setupLogger = new Logger('CorsSetup');
const DEVELOPMENT_DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function resolveCorsOrigins(
  frontendUrl = process.env.FRONTEND_URL,
  nodeEnv = process.env.NODE_ENV,
): string[] {
  const configuredOrigins = frontendUrl
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins && configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (nodeEnv === 'production') {
    throw new Error(
      'CRITICAL: Starting the server without FRONTEND_URL is a critical misconfiguration. It must contain the allowed frontend origin(s) for the dashboard-realtime gateway.',
    );
  }

  setupLogger.warn(
    `WARNING: CORS origins are empty because FRONTEND_URL is not set. Falling back to development origins: ${DEVELOPMENT_DEFAULT_ORIGINS.join(', ')}`,
  );
  return DEVELOPMENT_DEFAULT_ORIGINS;
}
```

Update `dashboard.gateway.ts` to import `resolveCorsOrigins` from the helper
and remove its duplicate logger/default/parser implementation. Re-export it
from the gateway module if needed to keep the existing gateway spec import
stable, then retain the existing configured-origin gateway assertions.

- [ ] **Step 4: Run the CORS and gateway tests**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/common/http/cors-origins.spec.ts src/dashboard-realtime/dashboard.gateway.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/common/http apps/core-api/src/dashboard-realtime/dashboard.gateway.ts apps/core-api/src/dashboard-realtime/dashboard.gateway.spec.ts
git commit -m "refactor(api): share HTTP and websocket CORS parsing"
```

### Task 2: Install and test the production HTTP security configurator

**Files:**
- Modify: `apps/core-api/package.json`
- Modify: `package-lock.json`
- Create: `apps/core-api/src/common/http/http-security.ts`
- Create: `apps/core-api/src/common/http/http-security.spec.ts`
- Modify: `apps/core-api/src/main.ts`

- [ ] **Step 1: Add current dependencies**

From the repository root, use npm to add the latest compatible packages to the
core-api workspace:

```bash
npm install --workspace=core-api helmet @nestjs/throttler
```

Confirm both packages appear in `apps/core-api/package.json` and the lockfile.

- [ ] **Step 2: Write the failing production configurator test**

Create a minimal Nest test app and assert the production-only headers:

```typescript
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttpSecurity } from './http-security';

@Controller('health')
class HealthController {
  @Get()
  getHealth() {
    return { ok: true };
  }
}

@Module({ controllers: [HealthController] })
class HealthModule {}

describe('configureHttpSecurity', () => {
  it('adds production Helmet headers without API CSP', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    configureHttpSecurity(app, {
      frontendUrl: 'https://app.example.com',
      nodeEnv: 'production',
    });
    await app.init();

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toBeUndefined();

    await app.close();
  });
});
```

- [ ] **Step 3: Run the security test and verify the expected failure**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/common/http/http-security.spec.ts
```

Expected: FAIL because `http-security.ts` and `configureHttpSecurity` do not
exist.

- [ ] **Step 4: Implement and wire the configurator**

Implement `configureHttpSecurity(app, options)` so it:

1. calls `app.getHttpAdapter().getInstance().set('trust proxy', true)`;
2. calls `app.use(helmet({ contentSecurityPolicy: false }))` only when
   `options.nodeEnv === 'production'`;
3. calls `app.enableCors` with
   `origin: resolveCorsOrigins(options.frontendUrl, options.nodeEnv)`,
   `methods: 'GET,HEAD,PUT,PATCH,POST,DELETE'`, and `credentials: true`.

Use an explicit options type with `frontendUrl?: string` and
`nodeEnv?: string`/the validated environment union. Update `main.ts` to call
the configurator after setting the global prefix and before `listen`, removing
the existing conditional single-string CORS block. Do not enable Helmet
unconditionally, so the normal test suite remains free of Helmet middleware.

- [ ] **Step 5: Run the focused security tests**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/common/http/http-security.spec.ts src/common/http/cors-origins.spec.ts
```

Expected: PASS with no CSP header and with the expected Helmet headers.

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/package.json package-lock.json apps/core-api/src/common/http/http-security.ts apps/core-api/src/common/http/http-security.spec.ts apps/core-api/src/main.ts
git commit -m "feat(api): add production HTTP security headers"
```

### Task 3: Add first global auth-route throttling

**Files:**
- Create: `apps/core-api/src/auth/auth-throttling.ts`
- Create: `apps/core-api/src/auth/auth-throttling.spec.ts`
- Modify: `apps/core-api/src/auth/auth.controller.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Write the failing route-selection tests**

Export constants and a pure route predicate from `auth-throttling.ts`, then
test the path/method boundary before implementing them:

```typescript
import { Request } from 'express';
import {
  AUTH_ME_RATE_LIMIT,
  AUTH_SWITCH_TENANT_RATE_LIMIT,
  shouldThrottleAuthRoute,
} from './auth-throttling';

describe('auth throttling', () => {
  it('selects only auth routes after the API prefix', () => {
    expect(
      shouldThrottleAuthRoute({
        method: 'GET',
        originalUrl: '/api/auth/me',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'POST',
        originalUrl: '/api/auth/switch-tenant',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'GET',
        originalUrl: '/api/customers',
      } as Request),
    ).toBe(false);
  });

  it('defines a generous read bucket and tighter write bucket', () => {
    expect(AUTH_ME_RATE_LIMIT).toEqual({ limit: 120, ttl: 60_000 });
    expect(AUTH_SWITCH_TENANT_RATE_LIMIT).toEqual({ limit: 10, ttl: 60_000 });
  });
});
```

- [ ] **Step 2: Run the route-selection tests and verify the expected failure**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/auth/auth-throttling.spec.ts
```

Expected: FAIL because the route predicate and constants do not exist.

- [ ] **Step 3: Implement the throttle configuration and decorators**

Implement path normalization that removes one leading `/api` and strips the
query string. Match exactly `GET /auth/me` and `POST /auth/switch-tenant`.
Export a `skipIf` callback that returns `!shouldThrottleAuthRoute(request)`.

Add the separate `@Throttle` metadata to `AuthController`:

```typescript
@Get('me')
@Throttle({ default: AUTH_ME_RATE_LIMIT })
...
@Post('switch-tenant')
@Throttle({ default: AUTH_SWITCH_TENANT_RATE_LIMIT })
...
```

Use `ThrottlerModule.forRoot([{ name: 'default', limit: 120, ttl: 60_000, skipIf }])`
in `AppModule`. Register:

```typescript
{
  provide: APP_GUARD,
  useClass: ThrottlerGuard,
},
{
  provide: APP_GUARD,
  useClass: JwtAuthGuard,
},
```

in exactly that order. Do not add `@UseGuards(ThrottlerGuard)` to the
controller; the global registration is required to throttle invalid JWT
requests before `JwtAuthGuard`. Express proxy trust is supplied by the HTTP
security configurator.

- [ ] **Step 4: Add an integration test for real Nest throttling**

Create a small Nest test module that imports the configured ThrottlerModule,
uses the real `ThrottlerGuard` as an `APP_GUARD`, exposes auth-shaped probe
routes with the same `@Throttle` metadata, and stubs the session service. Use
Supertest to assert:

```typescript
for (let attempt = 0; attempt < 10; attempt += 1) {
  await request(server).post('/auth/switch-tenant').send({ tenantId: 'tenant-1' }).expect(200);
}
await request(server).post('/auth/switch-tenant').send({ tenantId: 'tenant-1' }).expect(429);

for (let attempt = 0; attempt < 11; attempt += 1) {
  await request(server).get('/auth/me').expect(200);
}

for (let attempt = 0; attempt < 11; attempt += 1) {
  await request(server).get('/customers').expect(200);
}
```

The test must use a fresh app per test and close it in `afterEach` so the
in-memory counters do not leak between cases.

- [ ] **Step 5: Run the throttling tests**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/auth/auth-throttling.spec.ts
```

Expected: PASS, including `429` only after the tenth switch-tenant request
and no auth bucket on `/customers`.

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/src/auth/auth-throttling.ts apps/core-api/src/auth/auth-throttling.spec.ts apps/core-api/src/auth/auth.controller.ts apps/core-api/src/app.module.ts
git commit -m "feat(api): throttle auth routes before JWT validation"
```

### Task 4: Remove retired Cloud Build wiring and document the edge

**Files:**
- Modify: `cloudbuild.yaml`
- Modify: `README.md`
- Modify: `apps/core-api/scripts/dead-code-hygiene.spec.ts`

- [ ] **Step 1: Write the failing repository hygiene assertions**

Extend the existing hygiene suite to read `cloudbuild.yaml` and assert it does
not contain `API_KEY` or `VITE_API_KEY`, while explicitly allowing
`VITE_FIREBASE_API_KEY`:

```typescript
it('does not inject retired API_KEY values in Cloud Build', () => {
  const cloudBuild = fs.readFileSync(
    path.join(REPO_ROOT, 'cloudbuild.yaml'),
    'utf8',
  );
  expect(cloudBuild).not.toMatch(/API_KEY/);
  expect(cloudBuild).not.toMatch(/VITE_API_KEY/);
  expect(cloudBuild).toContain('VITE_FIREBASE_API_KEY');
});
```

- [ ] **Step 2: Run the hygiene test and verify the expected failure**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand scripts/dead-code-hygiene.spec.ts
```

Expected: FAIL because the existing Cloud Build file still contains retired
secret and export references.

- [ ] **Step 3: Remove only retired deployment references**

Delete the obsolete `availableSecrets` entry and comment, both
`API_KEY=API_KEY:latest` entries in `--set-secrets`, `API_KEY` from the
frontend step's `secretEnv`, and the `VITE_API_KEY` export. Keep
`VITE_FIREBASE_API_KEY`, `--allow-unauthenticated`, and all worker/task
secrets unchanged.

Add a README subsection under production auth explaining that Cloud Run is
still a public JWT API until Firebase Hosting rewrites or an equivalent
invoker boundary is deployed. Document that operators should delete the
retired GSM `API_KEY` secret after rollout and that Cloud Armor is an optional
operator follow-up, not a policy supplied by this change.

- [ ] **Step 4: Run the hygiene test and grep**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand scripts/dead-code-hygiene.spec.ts
rg -n "VITE_API_KEY|API_KEY" --glob '!**/node_modules/**' --glob '!**/generated/**' .
```

Expected: the hygiene test passes. Remaining matches, if any, are unrelated
provider-specific keys such as `NEON_API_KEY`, Firebase's
`VITE_FIREBASE_API_KEY`, or test assertions that explicitly ensure a retired
key is absent; there must be no production `API_KEY`/`VITE_API_KEY` deployment
instruction.

- [ ] **Step 5: Commit**

```bash
git add cloudbuild.yaml README.md apps/core-api/scripts/dead-code-hygiene.spec.ts
git commit -m "chore(ci): remove retired API key deployment wiring"
```

### Task 5: Verify the complete change

**Files:**
- Verify all modified files from Tasks 1–4.

- [ ] **Step 1: Run focused backend tests**

```bash
npm --prefix apps/core-api test -- --runInBand src/config src/auth src/common/http src/dashboard-realtime/dashboard.gateway.spec.ts scripts/dead-code-hygiene.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run the required backend build and checks**

```bash
npm exec --workspace=core-api -- prisma generate
npm run lint --workspace=core-api
npm run build --workspace=core-api
```

Expected: PASS with no TypeScript or ESLint errors.

- [ ] **Step 3: Confirm no API contract drift**

Run:

```bash
npm --prefix apps/core-api run openapi:check
```

Expected: PASS with no OpenAPI diff because only middleware and deployment
configuration changed.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff main...HEAD --check
git status --short --branch
```

Expected: no whitespace errors, only intended source/config/docs changes, and
the working tree clean.

- [ ] **Step 5: Commit any final correction**

If verification identifies a required correction, fix it test-first, rerun
the affected check, and commit it separately with a descriptive message.
