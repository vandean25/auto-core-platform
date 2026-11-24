# INFRA-12 Health Probe, Docker Cache, and Dependabot Design

## Goal

Make tag-triggered Cloud Build deployments start safely on Cloud Run, reuse
Docker layers from Artifact Registry, and keep dependency automation covering
the Dockerfile and GitHub Actions.

## Design

Add a dedicated `HealthController` with `GET /api/health`. The handler returns
the literal response `{ status: 'ok' }`, performs no database work, and is
decorated with `@Public()` so the global JWT guard cannot block Cloud Run's
startup probe. The controller is registered in `AppModule`, and the existing
HTTP interceptor skips this exact route so frequent probes do not emit request
metadata or PII.

Update both tag-triggered image builds in `cloudbuild.yaml` to use the existing
Docker builder's `docker buildx build --push`. Each image pushes its release
tag and writes/reads a dedicated registry cache manifest in
`europe-west3-docker.pkg.dev/auto-core-platform/core-services`. Remove the
separate push steps because Buildx performs the push atomically with the build.
Configure the API Cloud Run deployment with a startup HTTP probe for
`/api/health` on port `8080`; the application already binds `env.PORT` and
Cloud Run supplies that value at runtime.

Extend `.github/dependabot.yml` with a Docker update entry scoped to
`/apps/core-api` and a GitHub Actions entry scoped to `/`, preserving all
existing npm groups unchanged.

## Contract and tests

The health response is documented through Swagger decorators. Regenerate
`apps/core-api/openapi/openapi.json` and the frontend's generated OpenAPI
types. Add a fast unit test for the controller response and public metadata,
an e2e smoke test asserting unauthenticated `GET /api/health` returns 200, and
update interceptor coverage to assert health requests are not logged.

Verification includes the focused API tests, OpenAPI and generated-type drift
checks, API lint/build, and the repository's e2e suite when the local test
database is available. Configuration assertions are reviewed directly in the
changed YAML.

## Scope

Do not add a database-backed readiness endpoint, change the tag-triggered
release flow to GitHub Actions, or alter unrelated dependency groups.
