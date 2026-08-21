# Google Secret Manager Setup

This project supports pulling local `.env` files from Google Secret Manager (GSM).

## 1. Prerequisites

1. Install Google Cloud CLI (`gcloud`)
2. Login:
   - `gcloud auth login`
3. Set default project:
   - `gcloud config set project auto-core-platform-vande`
4. Ensure your account can access the required secrets:
   - IAM role typically needed: `Secret Manager Secret Accessor`

## 2. Configure Mapping

1. Copy mapping template:
   - `Copy-Item secrets/gsm-mapping.example.json secrets/gsm-mapping.json` (PowerShell)
   - `copy secrets\gsm-mapping.example.json secrets\gsm-mapping.json` (Windows cmd)
   - `cp secrets/gsm-mapping.example.json secrets/gsm-mapping.json` (macOS/Linux)
2. Update secret names in `secrets/gsm-mapping.json` to match your GSM secret names.

`secrets/gsm-mapping.json` is ignored by git and can contain machine-specific mappings.

## 3. Pull Secrets

From repository root:

- Pull backend env:
  - `npm --prefix apps/core-api run secrets:pull`
- Pull frontend env:
  - `npm --prefix apps/core-web run secrets:pull`
- Pull both:
  - `node tools/pull-secrets-from-gsm.mjs --mapping secrets/gsm-mapping.json`

Dry-run:

- `node tools/pull-secrets-from-gsm.mjs --mapping secrets/gsm-mapping.json --dry-run`

Release consistency rule:

- The release values in `cloudbuild.yaml` for `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` must match the GSM secrets used by the `core-web` target.
- The backend `FIREBASE_PROJECT_ID` used by release Cloud Run and local `core-api` env pulls must resolve to the same Firebase project as the browser token audience.

## 4. Outputs

- Backend env file: `apps/core-api/.env`
- Frontend env file: `apps/core-web/.env.local`

## 5. Recommended Team Practice

1. Keep secret values only in GSM.
2. Do not commit `.env` files.
3. Store only mapping templates in git.
4. Use separate secrets for `dev`, `staging`, and `prod`.
5. Give AI agents separate low-privilege service identities.

## 6. Sentry Source Map CI Secrets

To upload frontend source maps to Sentry for tagged production builds, keep
these values in GSM:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

The tag-triggered Cloud Build `build-frontend` step reads these values through
`availableSecrets` and injects them into the `core-web` build. Cloud Build is
the sole production source-map uploader. It sets both `SENTRY_RELEASE` and
`VITE_APP_VERSION` to `${TAG_NAME}`, so the browser release and Cloud Run API
release use the same git tag.

## 7. Database Pooling Secrets (Multi-Tenant)

For multi-tenant runtime stability, keep separate GSM secrets for direct and pooled database endpoints:

- `DATABASE_URL` (direct endpoint, migrations/admin)
- `DATABASE_URL_POOLED` (runtime pooled endpoint via PgBouncer/Neon pooler/Data Proxy)

Recommended mapping pattern in `secrets/gsm-mapping.json`:

- backend `.env` `DATABASE_URL` -> GSM direct secret (`acp-core-api-database-url`)
- backend `.env` `DATABASE_URL_POOLED` -> GSM pooled secret (`acp-core-api-database-url-pooled`)

NestJS runtime reads `DATABASE_URL_POOLED` and falls back to `DATABASE_URL`. Prisma migrate/seed keep using `DATABASE_URL` only. See `secrets/gsm-mapping.example.json`.

## 8. Workshop Media Storage

The `core-api` Cloud Run service receives the workshop media bucket through
Google Secret Manager. The deploy contract requires the secret name to be
exactly `WORKSHOP_MEDIA_BUCKET`:

```bash
gcloud secrets create WORKSHOP_MEDIA_BUCKET \
  --replication-policy=automatic \
  --project=auto-core-platform
printf '%s' 'acp-workshop-media' | \
  gcloud secrets versions add WORKSHOP_MEDIA_BUCKET \
  --data-file=- \
  --project=auto-core-platform
```

Grant the Cloud Run runtime service account (`430221429044-compute@developer.gserviceaccount.com`) Secret Accessor:

```bash
gcloud secrets add-iam-policy-binding WORKSHOP_MEDIA_BUCKET \
  --member=serviceAccount:430221429044-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor \
  --project=auto-core-platform
```

Create the bucket in `europe-west3` if it does not already exist:

```bash
gcloud storage buckets create gs://acp-workshop-media \
  --location=europe-west3 \
  --project=auto-core-platform \
  --uniform-bucket-level-access
```

Grant the Cloud Run runtime service account access to the bucket (`roles/storage.objectAdmin`, or a narrower equivalent):

```bash
gcloud storage buckets add-iam-policy-binding gs://acp-workshop-media \
  --member=serviceAccount:430221429044-compute@developer.gserviceaccount.com \
  --role=roles/storage.objectAdmin \
  --project=auto-core-platform
```

### Bucket CORS for Direct Client Uploads

Mechanic media uses short-lived GCS signed POST policies (ADR-0014 §7.1) for direct browser-to-bucket uploads. Apply a CORS policy on `gs://acp-workshop-media` allowing signed POST from the web app origin:

```json
[
  {
    "origin": [
      "https://auto-core-platform-vande.web.app",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ],
    "method": ["GET", "POST", "OPTIONS", "HEAD"],
    "responseHeader": ["*"],
    "maxAgeSeconds": 3600
  }
]
```

Apply the CORS configuration:

```bash
gcloud storage buckets update gs://acp-workshop-media \
  --cors-file=cors.json \
  --project=auto-core-platform
```

### Local Development Mapping

In `secrets/gsm-mapping.example.json`, `WORKSHOP_MEDIA_BUCKET` explicitly targets `projectId: "auto-core-platform"` because production storage credentials live in the core project. Local `npm --prefix apps/core-api run secrets:pull` requires the user to have Secret Accessor permissions on `projects/auto-core-platform/secrets/WORKSHOP_MEDIA_BUCKET`.

Do not commit the bucket's private objects or the secret value. The API keeps
`WORKSHOP_MEDIA_BUCKET` optional during boot and fails closed at the mechanic
media use site when storage is not configured.

## 9. Neon pooler cutover

The Cloud Run runtime pooled secret should be a separate GSM secret named
`acp-core-api-database-url-pooled`. Its value must be a Neon pooled connection
string whose hostname contains `-pooler`. Do not put that value in
`DATABASE_URL`: Prisma migrations use the direct endpoint and cannot use a
transaction-mode pooler.

Before overriding Cloud Build `_DATABASE_POOLED_SECRET`:

1. Create the secret in the `auto-core-platform` project.
2. Add the pooled Neon URL as its version.
3. Grant the Cloud Run runtime service account `Secret Manager Secret Accessor`
   on the secret.
4. Deploy and verify the startup structured log plus
   `tools/pooling/check-pool-settings.sql`.
5. Override Cloud Build `_DATABASE_POOLER_REQUIRED=true` only after the pooled
   host and SQL evidence are confirmed.

The checked-in Cloud Build default now points `_DATABASE_POOLED_SECRET` at
`acp-core-api-database-url-pooled` after the operator creates that GSM secret.
Override `_DATABASE_POOLER_REQUIRED=true` only after deploy verification.
