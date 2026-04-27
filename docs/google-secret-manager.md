# Google Secret Manager Setup

This project supports pulling local `.env` files from Google Secret Manager (GSM).

## 1. Prerequisites

1. Install Google Cloud CLI (`gcloud`)
2. Login:
   - `gcloud auth login`
3. Set default project:
   - `gcloud config set project auto-core-platform`
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

To upload frontend source maps to Sentry during CI builds, keep these values in GSM:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

The GitHub Actions workflow `.github/workflows/core-web-sentry-sourcemaps.yml` fetches those secrets from GSM using workload identity and injects them into the `core-web` build step.

Required GitHub repository secrets for GSM access:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `GCP_PROJECT_ID`
- `GSM_SENTRY_AUTH_TOKEN_SECRET`
- `GSM_SENTRY_ORG_SECRET`
- `GSM_SENTRY_PROJECT_SECRET`

## 7. Database Pooling Secrets (Multi-Tenant)

For multi-tenant runtime stability, keep separate GSM secrets for direct and pooled database endpoints:

- `DATABASE_URL` (direct endpoint, migrations/admin)
- `DATABASE_URL_POOLED` (runtime pooled endpoint via PgBouncer/Neon pooler/Data Proxy)

Recommended mapping pattern in `secrets/gsm-mapping.json`:

- backend `.env` `DATABASE_URL` -> GSM `DATABASE_URL_POOLED`
- backend `.env` `DATABASE_URL_DIRECT` -> GSM `DATABASE_URL`

This keeps application runtime on the pool while preserving direct connectivity for operational scripts.
