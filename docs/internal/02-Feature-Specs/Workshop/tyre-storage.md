# Tyre storage (Reifeneinlagerung)

Customer-owned wheel/tyre sets tracked per site with storage location, season, check-in/out history, and a manual due-for-swap list. This is **not** parts inventory: no stock ledger, valuation, invoices, or outbound reminders.

## Data model

- `TyreSet` — customer (required), optional vehicle, site, optional `StorageLocation`, season, status, bin label, planned swap date.
- `TyreSetEvent` — append-only ledger (`CHECK_IN`, `CHECK_OUT`, `MOVED`, `INSPECTED`, `DISPOSED`). Current status/location must match the last state-changing event.
- `TyreStorageSettings` — tenant singleton for season swap defaults (1 Mar summer / 1 Oct winter by default) and due-list window (days).
- Legacy `tread_depth_mm_json` on sets and events stays readable and is not rewritten. New tread evidence lives in `TyreMeasurement` / `TyreWheelReading`; see [tyre measurement](tyre-measurement.md).

## API

- `GET/POST/PATCH/DELETE /api/tyre-sets`
- `POST /api/tyre-sets/:id/check-in|check-out|move`
- `POST /api/tyre-sets/:id/inspect` (condition record without changing status/location)
- `GET /api/tyre-sets/due-for-swap` and `GET /api/tyre-sets/due-for-swap/export` (CSV, no messaging)
- `GET/PUT /api/tyre-sets/settings`
- Set detail and list rows include `latestMeasurement` (wheels, frozen evaluation, `worstStatus`) when tread evidence exists.
- RBAC: `OWNER` / `ADMIN` / `SALES` write (Linear's SERVICE_ADVISOR maps to tenant `SALES`; no separate tenant role exists); `TECH` read, and `TECH` may call `inspect` with `wheels`.
- `check-in`, `check-out` and `inspect` accept optional `wheels` and write one event-linked measurement in the same transaction; events without readings behave as before. Validation reuses the measurement capture rules.
- Legacy backfill: `npm run db:backfill:tyre-measurements --workspace=core-api` (dry-run) then `-- --execute`; idempotent, middle-point only, legacy JSON untouched.

## UX

- **Reifenlager** list (`/workshop/tyre-storage`) with filters, due toggle, CSV export, tablet-friendly actions.
- Vehicle and workshop order detail show linked sets (read-only chips).
- Printable storage tag from set detail (browser print stylesheet).

## Non-goals

Storage fees, barcode scanning, TPMS/legal profile checks, automated email/SMS, parts catalog sales.
