# INFRA-12 Health Probe, Docker Cache, and Dependabot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public DB-free health probe, configure Cloud Run startup probing and registry-backed Docker layer caching, and expand Dependabot coverage.

**Architecture:** A standalone `HealthController` owns `GET /api/health` and returns a fixed response without injecting Prisma or any other external dependency. It is registered beside `AppController`, marked public for the global JWT guard, and excluded from structured HTTP request logging. Cloud Build uses the existing Docker builder with Buildx cache manifests and pushes release images directly; Cloud Run probes the API on its injected service port.

**Tech Stack:** NestJS 11, Jest, Supertest, Swagger/OpenAPI, Cloud Build YAML, Docker Buildx, Cloud Run, Dependabot.

---

### Task 1: Add failing health and logging tests

**Files:**
- Create: `apps/core-api/src/health.controller.spec.ts`
- Modify: `apps/core-api/src/common/logging/http-logging.interceptor.spec.ts`
- Modify: `apps/core-api/test/app.e2e-spec.ts`

- [ ] **Step 1: Write the unit test first**

Create a `HealthController` test that imports `IS_PUBLIC_KEY`, `PATH_METADATA`, and `METHOD_METADATA`, then asserts `getHealth()` returns `{ status: 'ok' }` and the handler metadata is public, uses the `health` path, and uses GET.

- [ ] **Step 2: Change the interceptor test to specify the no-log behavior**

Change the existing unauthenticated `/api/health` test so its observable completes and then asserts `mockLoggerLog` was not called. Keep the request URL and response payload representative of the startup probe.

- [ ] **Step 3: Add the unauthenticated e2e smoke**

In `apps/core-api/test/app.e2e-spec.ts`, add a test that requests `/api/health` without an `Authorization` header, expects HTTP 200, and expects `{ status: 'ok' }`. This must be a separate test from the authenticated root route.

- [ ] **Step 4: Run the focused tests and verify they fail for missing behavior**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/health.controller.spec.ts src/common/logging/http-logging.interceptor.spec.ts
```

Expected result: the health test cannot resolve `./health.controller`, and the interceptor test fails because the current interceptor logs the health request. Do not proceed until the failures are caused by the missing behavior rather than test syntax errors.

### Task 2: Implement the DB-free public health endpoint

**Files:**
- Create: `apps/core-api/src/health.controller.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Add the minimal controller**

Implement:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
      },
      required: ['status'],
    },
  })
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 2: Register the controller**

Import `HealthController` in `app.module.ts` and add it to the module's `controllers` array without adding Prisma or a database service dependency.

- [ ] **Step 3: Make the interceptor skip the probe**

In `http-logging.interceptor.ts`, return `next.handle()` immediately when the HTTP request path is exactly `/api/health` (allowing a query string by checking the pathname before `?`). This avoids logging request metadata for the unauthenticated probe while leaving all other routes unchanged.

- [ ] **Step 4: Run the unit tests and verify they pass**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/health.controller.spec.ts src/common/logging/http-logging.interceptor.spec.ts
```

Expected result: all focused health and interceptor tests pass.

### Task 3: Configure deployment caching and startup probing

**Files:**
- Modify: `cloudbuild.yaml`

- [ ] **Step 1: Convert the API build to Buildx with a registry cache**

Use the existing Docker builder and build the `api` target with:

```yaml
- buildx
- build
- --push
- --target
- api
- --cache-from
- type=registry,ref=europe-west3-docker.pkg.dev/auto-core-platform/core-services/core-api:cache
- --cache-to
- type=registry,ref=europe-west3-docker.pkg.dev/auto-core-platform/core-services/core-api:cache,mode=max
```

Keep the existing API release tag and Dockerfile arguments. Remove the separate API push step because `--push` publishes the release image.

- [ ] **Step 2: Convert the worker build to Buildx with its own registry cache**

Apply the same pattern to the `worker` target, using the existing worker release tag and cache ref `core-api-pdf-worker:cache`. Remove the separate worker push step.

- [ ] **Step 3: Configure the API Cloud Run startup probe**

Add `--startup-probe httpGet.path=/api/health,httpGet.port=8080` to the API `gcloud run deploy` command. Leave the worker deployment unchanged because it is not the public HTTP API and its worker route is IAM/HMAC protected.

### Task 4: Extend Dependabot and regenerate API contracts

**Files:**
- Modify: `.github/dependabot.yml`
- Modify: `apps/core-api/openapi/openapi.json`
- Modify: `apps/core-web/src/api/generated/openapi.ts`

- [ ] **Step 1: Add Docker and GitHub Actions update entries**

Add a weekly Docker entry at `/apps/core-api` and a weekly GitHub Actions entry at `/`, preserving the existing npm entry and all npm groups.

- [ ] **Step 2: Generate the OpenAPI contract**

Run:

```bash
npm --prefix apps/core-api run openapi:generate
```

Expected result: `openapi/openapi.json` includes `GET /api/health` with the `{ status: string }` response.

- [ ] **Step 3: Generate frontend API types**

Run:

```bash
npm --prefix apps/core-web run api:types:generate
```

Expected result: the generated frontend contract includes the `/api/health` path.

### Task 5: Verify all acceptance criteria

**Files:** None.

- [ ] **Step 1: Run focused API unit tests**

Run `npm --prefix apps/core-api test -- --runInBand src/health.controller.spec.ts src/common/logging/http-logging.interceptor.spec.ts`.

- [ ] **Step 2: Run contract drift checks**

Run `npm --prefix apps/core-api run openapi:check` and `npm --prefix apps/core-web run api:types:check`; both must exit successfully with no generated diff.

- [ ] **Step 3: Run API lint and build**

Run `npm run lint --workspace=core-api` and `npm run build --workspace=core-api`; both must pass.

- [ ] **Step 4: Run the health e2e smoke**

Start PostgreSQL if needed, migrate the fresh `auto_core_test` database using the repository instructions, and run:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm --prefix apps/core-api run test:e2e -- --ci --runInBand test/app.e2e-spec.ts
```

Expected result: the unauthenticated health request passes with HTTP 200 and the expected JSON response.

- [ ] **Step 5: Review the final diff and commit**

Run `git diff --check` and inspect `git diff --stat` plus the complete diff. Commit the implementation as `feat(infra): add health probe and registry docker cache`.
