# Node 22 Slim API Image Design

## Goal

Build separate production images from one shared NestJS builder: a Node 22 slim
API image without downloaded Playwright browsers and a Playwright worker image
for Cloud Tasks PDF rendering.

## Architecture

`apps/core-api/Dockerfile` will retain one shared `builder` stage and add two
final targets:

- `api`: `node:22-slim`, with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` applied
  during dependency installation.
- `worker`: `mcr.microsoft.com/playwright:v1.62.1-jammy`, using the same
  compiled application and production dependency install. The same skip
  variable prevents npm from downloading a second browser version; browsers
  come from the pinned Microsoft image.

The API continues to contain the Playwright npm package because the compiled
Nest application shares worker code, but it will not contain Playwright browser
 binaries.

## Deployment

Cloud Build will build and push two Artifact Registry tags:

- `core-api:${TAG_NAME}` from the `api` target.
- `core-api-pdf-worker:${TAG_NAME}` from the `worker` target.

Cloud Run will deploy the worker image first and the API image second. Runtime
configuration and service boundaries remain unchanged.

## Drift Checks

The existing Playwright Docker pin test will be extended to read the worker
target's Playwright tag and compare it with the resolved `playwright` version
in `package-lock.json`. It will also verify that the API Docker target uses
`node:22-slim`, that Cloud Build uses `node:22`, and that the root and API
engine declarations require Node 22.

The check will not infer or validate a Node version from the Playwright image
tag.

## Scope

This change does not split the Nest application, remove the Playwright npm
dependency, add Docker caching, or change worker Socket.IO configuration.
