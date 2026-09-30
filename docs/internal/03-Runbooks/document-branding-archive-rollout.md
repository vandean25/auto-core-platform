# Document branding archive rollout

This runbook is the pre-writer gate for immutable branded invoice PDFs and
retained logo generations. The writer must remain disabled until every check
below passes for the target environment. Terraform injects the invoice bucket
name through Secret Manager but does not manage the bucket's lifecycle or IAM
policy.

## Rollout order

1. Deploy the additive archive metadata and invoice asset-reference migration.
   It leaves historical invoice snapshots and PDF metadata unchanged; archive
   columns remain null until an exact object generation has been verified.
2. Deploy readers and retention support while branded issuance remains
   disabled. Keep the V1/V2 historical render paths, fonts, and stored PDF
   readers available.
3. Complete the bucket, lifecycle, IAM, and generation/hash checks below.
   Record the evidence and have the release owner review it.
4. Enable the branded writer only after the release gate accepts the evidence.
   If any check fails or evidence is missing, keep the writer disabled.

## Resolve the deployment bucket and inspect it

Run from an authenticated Cloud SDK shell in the deployment project. Use the
project, region, service name, and secret name from the target deployment
configuration. The Terraform default secret name is `INVOICE_PDF_BUCKET`.
Keep shell tracing off and do not print the resolved bucket variable or secret
payload.

```bash
PROJECT_ID="$(gcloud config get-value project)"
INVOICE_PDF_BUCKET_SECRET_NAME="${TF_VAR_invoice_pdf_bucket_secret_name:-INVOICE_PDF_BUCKET}"
INVOICE_PDF_BUCKET="$(gcloud secrets versions access latest --secret="$INVOICE_PDF_BUCKET_SECRET_NAME" --project="$PROJECT_ID")"
gcloud storage buckets describe "gs://$INVOICE_PDF_BUCKET" --format=json
gcloud storage buckets get-iam-policy "gs://$INVOICE_PDF_BUCKET"
```

Letterhead sources, quarantine objects, and derived logos use the separate
`DOCUMENT_BRANDING_BUCKET` secret. Do not point it at the invoice archive
bucket: their access and retention lifecycles differ. Terraform and both
Cloud Build deployment configurations inject this secret into the API and PDF
worker. Resolve and inspect it separately before enabling uploads:

```bash
DOCUMENT_BRANDING_BUCKET_SECRET_NAME="${TF_VAR_document_branding_bucket_secret_name:-DOCUMENT_BRANDING_BUCKET}"
DOCUMENT_BRANDING_BUCKET="$(gcloud secrets versions access latest --secret="$DOCUMENT_BRANDING_BUCKET_SECRET_NAME" --project="$PROJECT_ID")"
gcloud storage buckets describe "gs://$DOCUMENT_BRANDING_BUCKET" --format=json
gcloud storage buckets get-iam-policy "gs://$DOCUMENT_BRANDING_BUCKET"
```

Also resolve the effective Cloud Run runtime service account from the deployed
service configuration. Do not assume the Compute default account. Record the
writer and cleanup principals separately. The current Terraform service runs
the API and its scheduled cleanup in one Cloud Run service and does not declare
a separate runtime account. If the deployed writer and cleanup share an
identity, split their runtime identities before granting bucket access; a
combined identity cannot satisfy the permission boundary below.

## Pass conditions

- Uniform bucket-level access is enabled.
- No lifecycle rule deletes objects matching the retained archive prefix or
  retained ready-logo prefix. Record the exact prefixes used by the deployed
  key builders. If logos use a separate configured bucket, inspect that bucket
  with the same lifecycle and IAM checks and record it separately.
- The writer principal can create and read the objects it needs to verify, but
  has no object delete or metadata-update permission. Creation uses a
  generation-match-zero precondition.
- The cleanup principal has only the narrowly scoped object-delete permission
  needed for confirmed unreferenced logo generations. It cannot delete archive
  objects. The application rechecks the invoice reference under the legal
  entity lock before marking an asset `DELETING` and before deleting the exact
  generation.
- A representative retained object can be read by its recorded generation;
  its stored SHA-256 metadata matches a freshly computed hash of those exact
  bytes. Confirm that the bucket's retention and access policy will keep that
  generation available for the lifetime of its invoice reference.
- The writer feature gate remains disabled until these checks and the rest of
  the AUT-323 acceptance gates are complete. Rollback disables new branded
  issuance and leaves readers, fonts, logo generations, and archive bytes
  available.

## Recovery, monitoring, and rollback

See the [Slice 1 release acceptance record](document-branding-slice-1-release-acceptance.md)
for automated checks, named-owner fields, and the current target-environment
gate state. Do not enable the writer while its storage, IAM, monitoring, or
rollback evidence is marked `PENDING` or `BLOCKED`.

- **Upload cleanup:** the recovery worker operates on persisted asset states
  and deletes only the recorded object generation with a generation-match
  precondition. A failed delete remains retryable; keep the asset in its
  recoverable state until that generation is deleted or its absence is
  verified. Never manually delete an object by key alone.
- **Extraction recovery:** expired leases are reclaimed by the recovery
  service and retried up to the configured attempt limit. Exhausted jobs become
  failed without publishing a proposal or changing the active profile. Keep
  manual settings usable while extraction is unavailable.
- **Archive publication recovery:** publication uses a deterministic immutable
  object identity. When object upload succeeds but invoice metadata persistence
  fails, the next render verifies the existing object and repairs the pointer.
  Preserve that object generation during retry and rollback.
- **Monitoring gate:** before writer activation, record the production
  dashboard and alert links, observed PDF publication/upload-cleanup/extraction
  recovery signals, thresholds, on-call owner, and an alert/recovery exercise.
  These values are target-environment evidence; this repository change does
  not assert that alerts or dashboards are configured.
- **Rollback:** disable new branded issuance and any approved extraction gate.
  Keep migrations, invoice/archive readers, historical renderer/font assets,
  immutable invoice PDFs, and referenced logo generations available. Do not
  delete issued evidence or run retention cleanup as a rollback action.

## Evidence record

Complete one record per deployment environment before changing the writer
gate. An incomplete record means the gate stays disabled.

| Field | Evidence |
|---|---|
| Environment and checked project | Not checked |
| Invoice bucket and retained archive prefix | Not checked |
| Logo bucket and retained logo prefix, if separate | Not checked |
| Writer service principal | Not checked |
| Cleanup service principal | Not checked |
| Evidence date (UTC) and reviewer | Not checked |
| Evidence artifact / change record | [Slice 1 release acceptance record](document-branding-slice-1-release-acceptance.md); target-environment evidence pending |
| Gate outcome | BLOCKED until the environment checks above are recorded |

## `INVOICE_BRANDING_WRITER_ENABLED` on Cloud Run

Live `core-api` was enabled manually on revision `00018` (approved gate). Tag
deploys use `gcloud run deploy --set-env-vars`, which **replaces** the full env
map, so the flag must stay in pipeline config or the next release drops it.

**Committed deploy config (persistent):**

- `cloudbuild.yaml` `deploy-cloud-run` (`core-api`): includes
  `INVOICE_BRANDING_WRITER_ENABLED=true`.
- `cloudbuild.staging.yaml` `deploy-staging-cloud-run`: includes
  `INVOICE_BRANDING_WRITER_ENABLED=true`.
- `core-api-pdf-worker` does **not** set this flag (finalize/issue runs on
  `core-api` only).

The API treats any value other than the literal string `true` as disabled and
returns `503` with code `INVOICE_BRANDING_WRITER_DISABLED` on invoice
finalize/issue paths (sales, workshop, vehicle sale). Clients should surface
that code when the flag is off (for example after rollback).

**Terraform (`infra/`):** optional parallel control via
`invoice_branding_writer_enabled` (defaults to `false` until a workspace opts in).
Prefer Cloud Build for the current live/staging services if that is the active
deploy path.

**Post-deploy smoke checks:**

1. Finalize a test sales invoice and confirm finalized status (not `503` /
   `INVOICE_BRANDING_WRITER_DISABLED`).
2. Download the issued invoice PDF and confirm archive metadata on the invoice
   record points at the expected immutable object generation.

**Rollback:** remove `INVOICE_BRANDING_WRITER_ENABLED=true` from the relevant
`--set-env-vars` line (or set `false`), redeploy `core-api` only, and verify
finalize returns `503` / `INVOICE_BRANDING_WRITER_DISABLED`. Do not delete issued
archive bytes or logo generations; readers and print paths must keep working.

## Letterhead extraction provider (`DOCUMENT_BRAND_*`)

Outbound letterhead extraction is **off by default** (`DOCUMENT_BRAND_EXTRACTION_PROVIDER=disabled`).
Manual branding settings and preview stay available when extraction is disabled.

| Name | Kind | Purpose |
|---|---|---|
| `DOCUMENT_BRAND_EXTRACTION_PROVIDER` | env | `disabled` (default), `openrouter`, or `vertex` (stub — always unavailable until Gemini-on-Vertex is implemented; does not call Vertex) |
| `DOCUMENT_BRAND_EXTRACTION_MODEL` | env | Optional OpenRouter model; code default `google/gemma-4-31b-it:free` |
| `OPENROUTER_API_KEY` | GSM secret | Required when provider is `openrouter`; mounted on **both** `core-api` and `core-api-pdf-worker` |

Cloud Build sets `DOCUMENT_BRAND_EXTRACTION_PROVIDER=disabled` on `core-api` and
`core-api-pdf-worker` and maps `OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest`.
**Before the first release that includes this pipeline**, Infra must create GSM
secret `OPENROUTER_API_KEY` and grant the Cloud Run runtime service account
secret accessor on it. `gcloud run deploy --set-secrets` fails the release if the
secret is missing, even while extraction stays disabled.

**OpenRouter (demo/UAT only):** free vision models are rate-limited and may log or
train on requests. Use synthetic or demo letterheads only until Vertex is approved
for customer data.

**Activation checklist (product/operations):**

1. Create GSM secret `OPENROUTER_API_KEY` in the deployment project (Infra).
2. Set `DOCUMENT_BRAND_EXTRACTION_PROVIDER=openrouter` on `core-api` and
   `core-api-pdf-worker` (and optional `DOCUMENT_BRAND_EXTRACTION_MODEL`).
3. Redeploy both services; confirm `capabilities.extractionAvailable` is true and
   a test letterhead upload yields a reviewable proposal.
4. Record provider, model, data-handling terms, and approver in
   [Slice 1 release acceptance](document-branding-slice-1-release-acceptance.md).

**Rollback:** set `DOCUMENT_BRAND_EXTRACTION_PROVIDER=disabled` on both services and
redeploy. Existing profiles and confirmed logos are unchanged; in-flight extractions
may fail safely.

