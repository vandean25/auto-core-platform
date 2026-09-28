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

## Evidence record

Complete one record per deployment environment before changing the writer
gate. An incomplete record means the gate stays disabled.

| Field | Evidence |
|---|---|
| Environment and checked project | Not checked in this Task 1 change |
| Invoice bucket and retained archive prefix | Not checked in this Task 1 change |
| Logo bucket and retained logo prefix, if separate | Not checked in this Task 1 change |
| Writer service principal | Not checked in this Task 1 change |
| Cleanup service principal | Not checked in this Task 1 change |
| Evidence date (UTC) and reviewer | Not checked in this Task 1 change |
| Evidence artifact / change record | Not checked in this Task 1 change |
| Gate outcome | BLOCKED until the environment checks above are recorded |
