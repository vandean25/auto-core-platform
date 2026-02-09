# Implementation Plan: Prepare Core API for Cloud Run Deployment

## Phase 1: Security & Global Configuration
- [ ] Task: Create `@Public()` decorator in `apps/core-api/src/common/decorators/public.decorator.ts`.
- [ ] Task: Implement a global authentication guard (e.g., using an existing AuthGuard or creating `ApiKeyGuard`) in `apps/core-api/src/main.ts`.
- [ ] Task: Configure strict CORS in `apps/core-api/src/main.ts` using `process.env.FRONTEND_URL`.
- [ ] Task: Update `main.ts` to listen on `process.env.PORT || 3000`.
- [ ] Task: Verification - Run manual tests or E2E tests to ensure CORS and Global Auth are working as expected.

## Phase 2: Containerization
- [ ] Task: Create a multi-stage `Dockerfile` in `apps/core-api/Dockerfile`.
    - [ ] Stage 1: Build (node:20-alpine, install deps, prisma generate, build).
    - [ ] Stage 2: Production (node:20-alpine, copy build artifacts, non-root user).
- [ ] Task: Create a `.dockerignore` file in `apps/core-api/.dockerignore`.
- [ ] Task: Verification - Build the docker image locally and verify its size and contents.

## Phase 3: Validation & Readiness
- [ ] Task: Create a `docker-compose.test.yml` (optional) or use a local container run to verify database connectivity via `DATABASE_URL`.
- [ ] Task: Verification - Run the container locally, passing `PORT`, `DATABASE_URL`, and `FRONTEND_URL` to ensure successful startup and connectivity.
