# Legacy DMS CSV import

## Summary

OWNER/ADMIN tenants can use **Settings → Data import** to upload legacy DMS CSV exports for **customers**, **vehicles**, **supplier price lists**, and **labor operations (Arbeitswerte)**, map columns, run a synchronous **dry-run**, review per-row actions, and **apply** results idempotently. External IDs from the source system are stored in `external_id_mappings` for reconciliation.

## incadea replacement strategy

[ADR-0031: incadea Migration and Hard Cutover to ACP](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md) records the accepted replacement strategy: 1–2 rehearsals, a hard cutover at a month/VAT-period boundary, and no parallel run. The wizard described below is the existing import foundation; it does not yet implement the complete migration scope.

Migration uses only canonical CSV v1 plus a manifest ([AUT-621](https://linear.app/auto-core-platform/issue/AUT-621)); the read-only extractor stays in a separate private repository. No proprietary source definitions or excerpts belong in ACP. Each source company maps to one legal entity and a distinct `incadea:<source company>` namespace for `ExternalIdMapping`.

Historical documents require separate read-only `LegacyDocument` tables and write-once evidence retention; they are excluded from ACP invoices, numbering and accounting exports under unchanged ADR-0023. The source export remains the archive of record. The staging-row purge described below must not delete retained document evidence. Open receivables remain accounting-owned and display-only in ACP.

The [canonical migration CSV v1 specification and manifest schema](migration-csv-format.md) (AUT-621) define the file contract; validator, fixtures and preset implementation belong to [AUT-645](https://linear.app/auto-core-platform/issue/AUT-645). [AUT-634](https://linear.app/auto-core-platform/issue/AUT-634) owns the planned cutover runbook at `docs/internal/05-Runbooks/incadea-cutover.md`, including the real-data DPA gate, archive evidence, GDPR filtering, per-entity RKSV readiness and business sign-offs.

## Settings UI

The shipped five-step wizard is available to users who can manage team settings:

1. Choose the entity and source system.
2. Upload a CSV and review the detected headers and preview rows.
3. Map CSV columns to import fields, or load and save a mapping profile for the entity and source system.
4. Run a dry-run, then filter and review the resulting rows by action or errors.
5. Apply the dry-run after reviewing the result.

The wizard can download entity templates and error-row CSVs. Marketing-consent columns are ignored by the import engine and reported as warnings.

### Labor operations (`LABOR_OPERATION`)

- Template columns (German headers): Arbeitswert-Nr, AW-Code, Beschreibung, AW, Stundensatz, optional internal cost, category name, and optional vehicle fitment (make, model, year from/to, engine code).
- Unknown category names import with `category_id = null` and a dry-run warning.
- Duplicate **code** within the file is an error; duplicate **code** in the tenant follows `update_existing` (update vs skip) like other entity types.
- Apply writes `LaborOperation` rows and optional `LaborFitment` rows; external IDs map through `external_id_mappings`.

## API (`/api/imports`)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/imports` | Multipart CSV + `mapping` + `options`; dry-run only |
| GET | `/imports/:id` | Job summary |
| GET | `/imports/:id/rows` | Paged rows; filter `action`, `hasErrors` |
| GET | `/imports/:id/errors.csv` | Error rows CSV |
| POST | `/imports/:id/apply` | Applies dry-run plan |
| GET | `/imports/templates/:entityType` | German headers + field list |
| GET | `/imports/templates/:entityType/csv` | Downloadable template |

## Options

- `update_existing` (default `false`)
- `fill_empty_only` (default `false`)
- `allow_missing_vin` (vehicles)
- `invalid_vat_as_error` (customers)
- Supplier price list options (`vendor_id`, price-jump acceptance) apply only to `SUPPLIER_PRICE_LIST`.

## Retention

Applied import jobs keep their header row and `external_id_mappings` for reconciliation. Row payloads (`import_job_rows`, including normalized CSV fields) are purged on a daily schedule when `status` is `APPLIED` and `appliedAt` is strictly older than **180 days** (`IMPORT_JOB_RETENTION_DAYS`). Dry-run, in-progress, failed, and cancelled jobs are never purged (no finish timestamp without a schema change). Job totals on `import_jobs` are not changed.

## Release notes

Expand-only migration adds `import_jobs`, `import_job_rows`, and `external_id_mappings`, and extends `ImportEntityType` with `LABOR_OPERATION`. No changes to `customers` / `vehicles` columns beyond mapping usage.
