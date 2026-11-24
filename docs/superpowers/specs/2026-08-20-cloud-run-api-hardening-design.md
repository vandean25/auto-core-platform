# Cloud Run API hardening design

## Goal

Remove the retired `API_KEY` deployment path and add narrowly scoped HTTP
hardening without changing the application's JWT authentication model or
making the public Cloud Run API private before Firebase Hosting rewrites are
available.

## Architecture

### Deployment secrets

`cloudbuild.yaml` will stop loading `API_KEY`, passing it to either Cloud Run
service, or exporting `VITE_API_KEY` during the frontend build. The Firebase
web configuration continues to use `VITE_FIREBASE_API_KEY`. The Cloud Run API
continues to deploy with `--allow-unauthenticated`; Firebase Hosting rewrites
or an equivalent load-balancer/invoker arrangement are outside this change.

### Shared CORS resolution

The existing gateway resolver will move to a shared HTTP configuration helper.
It will:

- split `FRONTEND_URL` on commas;
- trim entries and discard empty entries;
- return the localhost development defaults when the value is empty outside
  production;
- throw during production bootstrap when no origin remains.

Both the HTTP adapter and Socket.IO gateway will use this helper. HTTP CORS
will continue to allow credentials and the existing methods.

### HTTP security middleware

`main.ts` will call a small HTTP security configurator in production. The
configurator will install Helmet's default security policy, which is safe for
JSON API responses because it does not govern frontend resources. It will
retain Helmet's baseline headers including `X-Frame-Options`,
`Referrer-Policy`, and removal of `X-Powered-By`; frontend CSP remains
out-of-scope for INFRA-10.

The configurator will be independently testable without enabling Helmet for
the whole Jest `NODE_ENV=test` suite.

### Authentication throttling

`@nestjs/throttler` will be configured with its default in-memory storage.
The throttler will be registered as an `APP_GUARD` before the existing
`JwtAuthGuard` provider in `AppModule`.

The throttler's `skipIf` will leave all non-auth paths untouched and will
select only these paths after the `/api` global prefix:

- `GET /auth/me`: 120 requests per 60 seconds per client IP.
- `POST /auth/switch-tenant`: 10 requests per 60 seconds per client IP.

The guard must run before `JwtAuthGuard`, so requests with invalid or missing
JWTs consume the appropriate IP bucket instead of returning before throttling.
Route/method matching will distinguish the two buckets. The application will
set Express `trust proxy` so Nest's client IP resolution honors Cloud Run's
`X-Forwarded-For` chain. The in-memory counter is per Cloud Run instance; the
effective fleet-wide allowance can therefore scale with the configured
`--max-instances`. Redis or another distributed store is intentionally
deferred.

No global CRUD limit will be introduced, and no API-key guard or replacement
API-key scheme will be added.

## Request flow

1. `validateEnv()` validates the environment.
2. Bootstrap sets the Express proxy trust behavior and production Helmet.
3. Bootstrap resolves HTTP CORS origins through the shared helper.
4. The global throttler sees every request. It skips non-target routes, or
   tracks the matching auth route by IP and method.
5. `JwtAuthGuard` verifies the Firebase ID token and resolves local
   membership for requests that remain under the throttle.
6. Auth controller handlers read or mutate the session as they do today.

## Error handling and operational notes

- Production startup fails if `FRONTEND_URL` is missing or contains no usable
  origins, for both HTTP and WebSocket CORS.
- Throttled requests receive Nest's standard HTTP `429 Too Many Requests`.
- Cloud Run remains publicly reachable at this stage; JWT remains the API
  authorization boundary.
- After deployment, operators should delete the retired `API_KEY` secret from
  Google Secret Manager (including any frontend-project copy if present).
- Cloud Armor remains an optional operator follow-up, ideally after Hosting
  rewrites or a load balancer is introduced. This change does not claim that a
  Cloud Armor policy exists.

## Testing

Tests will be written before implementation and exercised through
red-green-refactor cycles:

1. Shared CORS tests cover comma-separated origins, trimming, development
   fallback, and production fail-fast behavior.
2. An HTTP security configurator test uses a production-mode Nest test app and
   Supertest to verify Helmet headers, including no `X-Powered-By` and at
   least one security header.
3. A real Nest throttler test sends requests to both auth routes and verifies
   that the switch-tenant route returns `429` after its lower threshold while
   `/auth/me` uses the higher threshold. It also verifies that a non-auth
   route is not subject to the auth buckets.
4. Existing auth, gateway, configuration, build, and repository hygiene tests
   continue to pass.

No OpenAPI route or DTO changes are expected.
