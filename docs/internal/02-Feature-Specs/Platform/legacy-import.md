# Legacy DMS CSV import (backend)

## Summary

OWNER/ADMIN tenants can upload legacy DMS CSV exports for **customers** and **vehicles**, run a synchronous **dry-run**, review per-row actions, and **apply** results idempotently. External IDs from the source system are stored in `external_id_mappings` for reconciliation.

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
- Mapping UI (AUT-382)

## Release notes

Expand-only migration adds `import_jobs`, `import_job_rows`, and `external_id_mappings`. No changes to `customers` / `vehicles` columns.
