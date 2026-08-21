# Cloud Run Environment Contract

## Context

The tag-triggered Cloud Build deploy uses `gcloud run deploy --set-env-vars`
and `--set-secrets`, which replace the service's existing environment set.
`core-api` already lists the Cloud Tasks settings and invoice PDF bucket, but
mechanic media storage also requires the `WORKSHOP_MEDIA_BUCKET` GSM secret.
The PDF worker must not receive mechanic-media or Cloud Tasks enqueue settings.

## Decision

Add `WORKSHOP_MEDIA_BUCKET=WORKSHOP_MEDIA_BUCKET:latest` to the `core-api`
deploy's `--set-secrets` argument only. Keep the existing invoice bucket
mapping on both services and leave `validateEnv` unchanged; bucket access is
intentionally fail-closed at the use site rather than at application boot.

Add a TypeScript contract check under `apps/core-api/scripts` with a Jest
specification. The check reads the `core-api` deploy block in `cloudbuild.yaml`,
collects keys from its `--set-env-vars` and `--set-secrets` arguments, and
asserts that the production runtime contract is present. The required set
includes the database URLs, API and Sentry settings, both bucket settings,
encryption key, Firebase project, release metadata, and all existing Cloud
Tasks enqueue/worker settings. Optional documented settings such as
`GCP_CREDENTIALS`, voice-note limits, and local-only settings remain outside
the contract.

Document the exact GSM secret name, the required `europe-west3` bucket, and
the Cloud Run runtime service account permission in the GSM guide and mapping
template.

## Testing

- The contract spec passes against the checked-in `cloudbuild.yaml`.
- The contract check exposes missing deploy keys so removing
  `WORKSHOP_MEDIA_BUCKET` or another required key fails CI.
- `env.spec.ts` remains unchanged for production fixtures and confirms
  `NODE_ENV=test` does not require deployment secrets.
- Run the targeted environment and contract tests, then the API build and
  lint.
