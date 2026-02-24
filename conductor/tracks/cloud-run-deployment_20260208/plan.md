# Implementation Plan: Prepare Core API for Cloud Run Deployment

## Phase 1: Security & Global Configuration
- [x] Task: Create `@Public()` decorator in `apps/core-api/src/common/decorators/public.decorator.ts`.
- [x] Task: Implement a global authentication guard (e.g., using an existing AuthGuard or creating `ApiKeyGuard`) in `apps/core-api/src/main.ts`.
  - **Runbook for ApiKeyGuard**: At runtime, the API key used by `ApiKeyGuard` is stored in Google Secret Manager as a versioned secret. It is exposed to Cloud Run via a secret environment variable properly mounted at boot.
  - **Rotation**: To rotate the API key, create a new secret version in Google Secret Manager, update the Cloud Run revision or CI/CD secret to point to the new version, and execute a deployment.
  - **Verification & Rollback**: Operators must verify logs and perform smoke test URLs (e.g., `/api`) after rotation or env changes to check access permissions. To rollback, revert the Cloud Run revision to the previous secret version and test again.
- [x] Task: Configure strict CORS in `apps/core-api/src/main.ts` using `process.env.FRONTEND_URL`.
  - **Runbook for FRONTEND_URL**: `FRONTEND_URL` is managed as a Cloud Run environment variable set from a Terraform variable or CI/CD secret. Ensure it is updated across environments accordingly. Verification includes smoke testing CORS behavior from the frontend.
- [x] Task: Update `main.ts` to listen on `process.env.PORT || 3000`.
- [x] Task: Verification - Run manual tests or E2E tests to ensure CORS and Global Auth are working as expected.

## Phase 2: Containerization
- [x] Task: Create a multi-stage `Dockerfile` in `apps/core-api/Dockerfile`.
    - [x] Stage 1: Build (node:20-alpine, install deps, prisma generate, build).
    - [x] Stage 2: Production (node:20-alpine, copy build artifacts, non-root user).
- [x] Task: Create a `.dockerignore` file in `apps/core-api/.dockerignore`.
- [ ] Task: Implement and expose a lightweight HTTP health/readiness endpoint (e.g., `/health`, `/readiness`, or `/ping`) from the API.
    - Ensure it is NOT protected by `ApiKeyGuard` or other auth middleware (reviewers should locate the guard and the endpoint implementation to adjust middleware as needed).
    - Verification: confirm the route exists and returns 200 from the container (suggest using the provided ripgrep search to detect existing endpoints and a local curl check against the running container).
- [x] Task: Verification - Build the docker image locally and verify its size and contents.

## Phase 3: Validation & Readiness
- [ ] Task: Create a `docker-compose.test.yml` (or run a local container) to run end-to-end checks before deploying to Cloud Run. Start the `apps/core-api` image with real environment variables (`PORT`, `DATABASE_URL`, `FRONTEND_URL`) and verify the container boots and serves.
- [ ] Task: Inside that test run, confirm Prisma can connect using `DATABASE_URL` (apply migrations or run a simple query) so the Dockerfile produced in `apps/core-api/Dockerfile` and the `.dockerignore` in `apps/core-api/.dockerignore` are exercised.
- [ ] Task: Fix any missing env handling or secrets required at boot.
- [ ] Task: Verification - Only mark Phase 3 tasks complete once startup and DB connectivity are validated locally.
