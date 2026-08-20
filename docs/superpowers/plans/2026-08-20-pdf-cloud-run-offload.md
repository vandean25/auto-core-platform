# PDF Cloud Run Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production PDF rendering to a dedicated Cloud Run worker and fail closed instead of rendering inline when the worker path is unavailable.

**Architecture:** Deploy the existing Playwright API image as `core-api-pdf-worker` with 2 GiB memory, concurrency 1, and zero-to-two instances. Deploy `core-api` at 512 MiB with Cloud Tasks enabled and target the worker URL plus `/api`; retain HMAC and signed tenant payload validation. Outside production, keep inline generation when task offload is disabled.

**Tech Stack:** NestJS, TypeScript, Jest, Google Cloud Tasks, Cloud Run, Playwright, Google Cloud Storage, Cloud Build.

---

### Task 1: Record the version and behavior regressions

**Files:**
- Create: `apps/core-api/src/invoices/invoice-pdf.service.spec.ts`
- Create: `apps/core-api/src/workshop/workshop-pdf.service.spec.ts`
- Create: `apps/core-api/scripts/playwright-version.spec.ts`
- Modify: `apps/core-api/package.json`
- Modify: `package-lock.json`
- Modify: `apps/core-api/Dockerfile`

- [ ] **Step 1: Write failing service tests**

Build minimal Prisma, tenant, renderer, storage, and Cloud Tasks test doubles. Assert that an ISSUED invoice and a workshop order throw in production when `cloudTasks.isEnabled()` is false, and that neither renderer is called. Assert that an enabled production task returns `mode: 'enqueued'` and does not call `generateNow`.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/invoices/invoice-pdf.service.spec.ts src/workshop/workshop-pdf.service.spec.ts
```

Expected: the production misconfiguration tests fail because the current services fall back to `generateNow()` when `CLOUD_TASKS_ENABLED` is not explicitly true, and the enqueue tests expose any mismatch in the production decision path.

- [ ] **Step 3: Add the version alignment assertion**

Read `apps/core-api/package.json`, `package-lock.json`, and `apps/core-api/Dockerfile`; assert that the exact `playwright` package version in the package manifest and lockfile equals the `v<version>-jammy` Docker tag.

- [ ] **Step 4: Pin Playwright**

Set the dependency to the exact lockfile version `1.62.1` and set the runner image to `mcr.microsoft.com/playwright:v1.62.1-jammy`.

- [ ] **Step 5: Run the version assertion**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand scripts/playwright-version.spec.ts
```

Expected: PASS after the manifest and Dockerfile are aligned.

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/src/invoices/invoice-pdf.service.spec.ts apps/core-api/src/workshop/workshop-pdf.service.spec.ts apps/core-api/scripts/playwright-version.spec.ts apps/core-api/package.json package-lock.json apps/core-api/Dockerfile
git commit -m "test(core-api): cover production PDF offload decisions"
```

### Task 2: Make PDF request routing fail closed in production

**Files:**
- Modify: `apps/core-api/src/invoices/invoice-pdf.service.ts`
- Modify: `apps/core-api/src/workshop/workshop-pdf.service.ts`
- Test: `apps/core-api/src/invoices/invoice-pdf.service.spec.ts`
- Test: `apps/core-api/src/workshop/workshop-pdf.service.spec.ts`

- [ ] **Step 1: Implement the smallest production guard**

Use `CloudTasksService.isEnabled()` as the offload decision. Enqueue only when it is enabled and the target base URL is present. If that path is unavailable, throw in production before `generateNow`; retain inline generation only for non-production when Cloud Tasks is disabled. Keep explicit task configuration failures fail-closed rather than silently rendering.

- [ ] **Step 2: Run the focused service tests**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/invoices/invoice-pdf.service.spec.ts src/workshop/workshop-pdf.service.spec.ts
```

Expected: PASS, including no renderer calls in production and no inline fallback in production.

- [ ] **Step 3: Run adjacent worker guard and task tests**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/common/services/cloud-tasks.service.spec.ts src/common/guards/cloud-tasks-worker.guard.spec.ts src/common/pdf
```

Expected: PASS, including signed tenant payload generation and invalid worker secret rejection.

- [ ] **Step 4: Commit**

```bash
git add apps/core-api/src/invoices/invoice-pdf.service.ts apps/core-api/src/workshop/workshop-pdf.service.ts apps/core-api/src/invoices/invoice-pdf.service.spec.ts apps/core-api/src/workshop/workshop-pdf.service.spec.ts
git commit -m "fix(core-api): fail closed when production PDF tasks are unavailable"
```

### Task 3: Wire the dedicated worker deployment

**Files:**
- Modify: `cloudbuild.yaml`
- Modify: `apps/core-api/.env.example`
- Modify: `docs/internal/01-ADR/2026-04-12-async-pdf-pipeline.md`

- [ ] **Step 1: Add deployment substitutions and worker secret**

Add the worker service name and GSM secret name. Deploy the shared image as `core-api-pdf-worker` in `europe-west3` with 2 GiB memory, CPU 1, concurrency 1, minimum zero, maximum two, and the worker secret.

- [ ] **Step 2: Discover the worker URL before deploying the API**

Write the worker service URL to a Cloud Build workspace file, then deploy `core-api` with `CLOUD_TASKS_ENABLED=true`, location `europe-west3`, queue `pdf-queue`, and `CLOUD_TASKS_TARGET_BASE_URL=<worker-url>/api`. Keep API memory at 512 MiB and concurrency 40.

- [ ] **Step 3: Document the environment contract and ADR consequence**

Document that the task target is the worker service URL, and update ADR-0007 to describe the separate worker service, its memory/concurrency isolation, and the required operator setup.

- [ ] **Step 4: Run static deployment checks**

Run:

```bash
rg -n "core-api-pdf-worker|CLOUD_TASKS_ENABLED=true|CLOUD_TASKS_LOCATION=europe-west3|CLOUD_TASKS_QUEUE=pdf-queue|CLOUD_TASKS_TARGET_BASE_URL|CLOUD_TASKS_WORKER_SECRET|--memory 2Gi|--concurrency 1" cloudbuild.yaml
```

Expected: all required worker and API settings are present, with no 1.51.0 Playwright image tag remaining.

- [ ] **Step 5: Commit**

```bash
git add cloudbuild.yaml apps/core-api/.env.example docs/internal/01-ADR/2026-04-12-async-pdf-pipeline.md
git commit -m "ci: deploy dedicated Cloud Run PDF worker"
```

### Task 4: Run full verification and hand off

**Files:**
- Test: existing targeted unit, e2e, and build commands

- [ ] **Step 1: Run the requested unit suite**

```bash
npm --prefix apps/core-api test -- --runInBand src/invoices src/workshop src/common/services/cloud-tasks.service.spec.ts src/common/pdf src/config/env.spec.ts
```

- [ ] **Step 2: Run the existing workshop PDF e2e**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" npm --prefix apps/core-api run test:e2e -- --ci --runInBand test/workshop-pdf.e2e-spec.ts
```

- [ ] **Step 3: Build the API**

```bash
npm --prefix apps/core-api run build
```

- [ ] **Step 4: Inspect tenant-scoped PDF queries and the final diff**

```bash
rg -n "prisma\\.client\\.(invoice|workshopOrder)" apps/core-api/src/invoices apps/core-api/src/workshop
git diff --check
git status --short
```

Expected: every PDF query remains constrained by `tenant_id`, the diff has no whitespace errors, and only scoped issue files are modified.

- [ ] **Step 5: Commit, push, and create the draft PR**

```bash
git push -u origin feature/offload-pdf-cloud-run-cbe6
```

Create or update the draft PR with the operator prerequisites: GSM worker secret, `pdf-queue` in `europe-west3`, Cloud Tasks create/invoke IAM, and post-deploy verification that the target URL is the worker Run URL plus `/api`.
