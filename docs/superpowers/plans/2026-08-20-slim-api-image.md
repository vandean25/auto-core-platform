# Slim API Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship separate Node 22 slim API and pinned Playwright PDF-worker images from one Dockerfile.

**Architecture:** Keep one shared `node:22-slim` builder and two production targets. Cloud Build builds and pushes one Artifact Registry tag per target, then deploys the worker and API with their corresponding image references.

**Tech Stack:** Docker multi-stage builds, Google Cloud Build, Cloud Run, Node.js 22, Jest/TypeScript drift checks.

---

### Task 1: Make image/version drift checks fail for the current configuration

**Files:**
- Modify: `apps/core-api/scripts/check-playwright-docker-version.spec.ts`
- Test: `apps/core-api/scripts/check-playwright-docker-version.spec.ts`

- [ ] **Step 1: Extend the existing spec to inspect the worker target, API target, Cloud Build, and engine declarations.**

Read `package-lock.json` as JSON and compare `packages["node_modules/playwright"].version` with the tag in the `FROM mcr.microsoft.com/playwright:vX.Y.Z-jammy AS worker` line. Assert the Dockerfile has `FROM node:22-slim AS api`, Cloud Build contains `name: node:22`, and both root and `core-api` `engines.node` equal `>=22`.

- [ ] **Step 2: Run the focused spec before production edits.**

Run: `npm test --workspace=core-api -- --runInBand scripts/check-playwright-docker-version.spec.ts`

Expected: FAIL because the current Dockerfile uses `node:20-slim` and has no `api` target, and the current engine declarations still allow Node 20.

- [ ] **Step 3: Commit the red test.**

```bash
git add apps/core-api/scripts/check-playwright-docker-version.spec.ts
git commit -m "test(infra): guard Node and image version drift"
```

### Task 2: Implement the split Docker targets

**Files:**
- Modify: `apps/core-api/Dockerfile`

- [ ] **Step 1: Change the shared builder to `node:22-slim` and set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before builder `npm ci`.**

- [ ] **Step 2: Add the `api` final target from `node:22-slim`, install production dependencies with `npm ci --omit=dev --workspace=core-api --include-workspace-root=false`, and set the skip variable in that stage.**

- [ ] **Step 3: Add the `worker` final target from the lockfile-pinned `mcr.microsoft.com/playwright:v1.62.1-jammy`, install the same production dependencies with the skip variable, and copy the same compiled app, Prisma client, and schema.**

- [ ] **Step 4: Keep `CMD ["node", "dist/src/main.js"]` in both targets.**

- [ ] **Step 5: Run the focused drift spec and confirm it passes.**

Run: `npm test --workspace=core-api -- --runInBand scripts/check-playwright-docker-version.spec.ts`

Expected: PASS.

### Task 3: Build and deploy separate Artifact Registry images

**Files:**
- Modify: `cloudbuild.yaml`

- [ ] **Step 1: Build and tag the Dockerfile `api` target as `core-api:${TAG_NAME}`.**

- [ ] **Step 2: Add build and push steps for the `worker` target as `core-api-pdf-worker:${TAG_NAME}`.**

- [ ] **Step 3: Point `deploy-pdf-worker` at the worker image while leaving its service configuration unchanged.**

- [ ] **Step 4: Leave the existing API deployment pointing at the API image and preserve worker-before-API deployment order.**

### Task 4: Align Node engines and infrastructure documentation

**Files:**
- Modify: `package.json`
- Modify: `apps/core-api/package.json`
- Modify: `agents.md`
- Modify: `docs/internal/01-ADR/2026-04-12-async-pdf-pipeline.md`

- [ ] **Step 1: Change root and API `engines.node` from `>=20` to `>=22`.**

- [ ] **Step 2: Update the prerequisite documentation from Node 20+ to Node 22+.**

- [ ] **Step 3: Correct the ADR to state that the API uses a browser-free slim image and only the worker uses the Playwright image.**

### Task 5: Verify the implementation

**Files:**
- Test: `apps/core-api/scripts/check-playwright-docker-version.spec.ts`

- [ ] **Step 1: Run the focused drift spec.**

Run: `npm test --workspace=core-api -- --runInBand scripts/check-playwright-docker-version.spec.ts`

Expected: PASS with all drift assertions passing.

- [ ] **Step 2: Build the API application.**

Run: `npm --prefix apps/core-api run build`

Expected: exit code 0 and compiled output under `apps/core-api/dist/src/main.js`.

- [ ] **Step 3: Validate YAML and inspect the final diff.**

Run: `git diff --check && git diff --stat && git status --short`

Expected: no whitespace errors, only the scoped infrastructure/version/documentation files changed, and no generated artifacts tracked.

- [ ] **Step 4: Commit the implementation and verification-ready revision.**

```bash
git add apps/core-api/Dockerfile apps/core-api/package.json apps/core-api/scripts/check-playwright-docker-version.spec.ts cloudbuild.yaml package.json agents.md docs/internal/01-ADR/2026-04-12-async-pdf-pipeline.md
git commit -m "feat(infra): split slim API and PDF worker images"
```
