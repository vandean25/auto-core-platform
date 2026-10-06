# Legacy DMS CSV import

## Summary

OWNER/ADMIN tenants can use **Settings → Data import** to upload legacy DMS CSV exports for **customers** and **vehicles**, map columns, run a synchronous **dry-run**, review per-row actions, and **apply** results idempotently. External IDs from the source system are stored in `external_id_mappings` for reconciliation.

## Settings UI

The shipped five-step wizard is available to users who can manage team settings:

1. Choose the entity and source system.
2. Upload a CSV and review the detected headers and preview rows.
3. Map CSV columns to import fields, or load and save a mapping profile for the entity and source system.
4. Run a dry-run, then filter and review the resulting rows by action or errors.
5. Apply the dry-run after reviewing the result.

The wizard can download entity templates and error-row CSVs. Marketing-consent columns are ignored by the import engine and reported as warnings.

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

## Follow-ups

- `first_registration_date` vehicle mapping after AUT-375 merges to `main`
- Import job row retention cleanup (default retention constant: 180 days)

## Release notes

Expand-only migration adds `import_jobs`, `import_job_rows`, and `external_id_mappings`. No changes to `customers` / `vehicles` columns.
