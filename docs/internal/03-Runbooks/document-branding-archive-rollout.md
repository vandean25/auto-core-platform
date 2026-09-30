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
