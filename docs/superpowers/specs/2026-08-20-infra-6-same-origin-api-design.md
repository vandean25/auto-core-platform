# INFRA-6 Same-Origin API via Firebase Hosting

## Goal

Serve browser API requests through the Firebase Hosting origin while keeping
NestJS on Cloud Run, so production frontend builds no longer embed a
revision-specific `*.run.app` URL.

## Architecture

Firebase Hosting will route `/api/**` to the existing `core-api` Cloud Run
service in `europe-west3`, before the existing SPA fallback. The frontend
production build will leave `VITE_API_BASE_URL` empty, which preserves relative
`/api/...` requests and makes HTTP traffic same-origin.

Realtime connection resolution will keep the existing direct-origin behavior
when an API base URL is explicitly supplied, while an empty base URL uses the
browser origin and `/api/socket.io` in production. Development continues to
use Vite's `/socket.io` proxy. Firebase Hosting's Cloud Run rewrite is
documented and configured as the first attempt for the Socket.IO handshake;
staging validation remains an operator step because Hosting rewrite behavior
for WebSocket upgrades is not guaranteed by the documented HTTP rewrite
contract.

## Components and data flow

1. `firebase.json` adds a Cloud Run rewrite for `/api/**`, using service
   `core-api` and region `europe-west3`, before `**` → `/index.html`.
2. `cloudbuild.yaml` stops reading `.run_url` for the frontend build and does
   not export `VITE_API_BASE_URL`.
3. `apps/core-web/src/api/client.ts` retains its empty-base relative URL
   behavior and gains focused tests covering string and `URL` inputs.
4. `RealtimeDashboardSyncProvider` retains `/socket.io` only for development
   and uses `/api/socket.io` for same-origin production connections, with tests
   covering the empty-base production case.
5. `apps/core-web/src/sentry/config.ts` treats an empty API base as no
   additional propagation target, avoiding an empty Sentry target.
6. README production environment guidance states that `VITE_API_BASE_URL` is
   not required; the Hosting rewrite supplies `/api` and `/api/socket.io`.
   It also calls out the required staging WebSocket upgrade check and the
   direct Cloud Run fallback if Hosting cannot proxy the upgrade.

## Error handling and compatibility

No runtime fallback is added to silently switch between Hosting and Cloud Run:
the browser uses same-origin URLs by default, while an explicitly configured
API base remains supported for local or direct-origin deployments. Existing
authentication headers and Socket.IO options are unchanged.

## Testing

Tests will be written or extended before implementation and will cover:

- `resolveApiUrl` preserving relative API paths when the base is empty,
- Sentry omitting an empty base from propagation targets,
- realtime resolving an empty-base production connection to the browser origin
  and `/api/socket.io`,
- existing configured-base and development proxy behavior.

Verification will run the focused frontend tests, the frontend build, and the
frontend lint check. Firebase configuration will be validated by parsing the
JSON and reviewing rewrite order.

## Scope

This change does not move NestJS to Cloud Functions, alter Cloud Run ingress,
remove `FRONTEND_URL`, or purchase/configure a custom domain. Cloud Run IAM
changes and production WebSocket validation remain operator follow-up steps.
