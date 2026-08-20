# PDF Cloud Run Offload Design

## Goal

Prevent production invoice and workshop PDF requests from launching Chromium in
the user-facing API service while preserving the existing asynchronous task
contract and local/test inline generation.

## Architecture

The repository will deploy the existing API image twice:

- `core-api` remains the user-facing service at 512 MiB, with PDF requests
  enqueueing Cloud Tasks only.
- `core-api-pdf-worker` is the Cloud Tasks target at 2 GiB, concurrency 1,
  maximum two instances, and zero minimum instances. It runs the existing
  worker routes and Playwright renderer.

The API's `CLOUD_TASKS_TARGET_BASE_URL` will point to the worker service URL
including `/api`. The worker remains protected by the existing
`x-cloud-tasks-secret` guard and signed tenant payload guard. Cloud Run
unauthenticated ingress is retained for the worker service because the current
Cloud Tasks client supplies HMAC authentication rather than an OIDC token;
worker routes are not exposed as browser functionality and reject requests
without the shared secret.

## Application behavior

`CloudTasksService.isEnabled()` remains the single configuration check for
task offloading. Both PDF services will:

1. Return the cached PDF without enqueueing when a valid cache exists.
2. Enqueue through Cloud Tasks when task configuration and target URL are
   available.
3. Throw `InternalServerErrorException` in production when the task path is
   unavailable, before calling `generateNow`.
4. Preserve inline generation only outside production when tasks are disabled.

The task body, HMAC header, `x-tenant-id` header, and all tenant-scoped Prisma
queries remain unchanged.

## Deployment and versioning

Cloud Build will deploy the worker before the API, discover the worker's stable
Run URL, and inject that URL into the API deployment. It will inject all
Cloud Tasks settings and the worker secret into both services. The worker's
runtime memory and concurrency will isolate Chromium from the API footprint.

The Playwright npm dependency will be pinned to the lockfile's resolved
`1.62.1` version and the runner image will use
`mcr.microsoft.com/playwright:v1.62.1-jammy`. A test will assert that the
Docker image tag matches the exact npm dependency and lockfile version.

## Error handling and operations

Production enqueue failures remain fail-closed and persist a tenant-scoped
generation error where possible. Non-production enqueue failures may retain the
existing inline fallback. Operators must provision the worker secret, the
`europe-west3` `pdf-queue`, and Cloud Tasks permissions for the runtime service
account in project `auto-core-platform`.

## Verification

The change will add unit coverage for production misconfiguration, production
enqueue behavior without renderer calls, and deployment version alignment. The
existing worker-secret rejection tests and workshop PDF e2e inline path remain
required. Verification also includes the requested targeted unit suite, e2e
test, and API build.
