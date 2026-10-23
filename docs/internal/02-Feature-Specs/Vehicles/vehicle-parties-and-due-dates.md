---
title: "Vehicle parties and due dates (backend)"
date: "2026-10-22"
module: Vehicle
status: draft
linear-project: "legacy DMS migration"
tags:
  - feature-spec
  - vehicle
  - migration
---

# Vehicle parties and due dates (backend)

## Summary

A vehicle has more than one relevant party over time: owner, driver, bill-to, leasing company, insurer, previous owners. AUT-641 PR-A models them as time-bounded `VehicleParty` rows, adds the `VehicleNotice` table, and imports parties and due dates from the canonical migration CSV 1.1 ([migration-csv-vehicles.md](../Platform/migration-csv-vehicles.md)), so the Pickerl due list and service due dates work from day one after cutover. This page covers the API, MCP, invariants, import behavior and the vehicle UI. No reminder, notification, cron job or realtime registration is added.

`Vehicle.customer_id` stays the main contact. It follows the single OWNER that is active today and is written only by the party writer (`setOwnerInTx`, see the invariants below).

## Data model

| Table | Purpose |
|---|---|
| `vehicle_parties` | `role` (`OWNER`, `DRIVER`, `USER`, `BILL_TO`, `LEASING`, `INSURANCE`, `WARRANTY_PROVIDER`, `SERVICE_CONTRACT`, `PREVIOUS_OWNER`), `valid_from` / `valid_to` as dates, `source` (`MANUAL` or `LEGACY_IMPORT`), `notes`. Composite tenant FKs to vehicles and customers, `ON DELETE RESTRICT`. |
| `vehicle_notices` | `type` (`CAMPAIGN`, `RECALL`, `REMARK`, `WARNING`, `SERVICE_DUE`), `title`, `body`, `status` (`OPEN`, `DONE`, `DISMISSED`), `due_date`, `due_mileage`, `external_ref`, `source`, `created_by_user_id`, `resolved_at`, `resolved_by_user_id`, `resolved_workshop_order_id`. Carries every column the notices work (AUT-642) needs. |
| `vehicle_inspection_records.source` | gains `LEGACY_IMPORT`. |

The interval is half-open: a party is active on day D when `valid_from <= D < valid_to`. A blank bound is unbounded. SQL-only constructs (documented on the Prisma models): the `valid_from < valid_to` check, a partial unique index that allows one open-ended OWNER, BILL_TO and LEASING per vehicle, and a partial unique index on `(vehicle, type, external_ref)` for notices.

## Invariants

- At most one OWNER, one BILL_TO and one LEASING per vehicle at any date, including future intervals. Adjacent intervals are valid. Other roles allow concurrent distinct customers; overlapping intervals for the same `(customer, role)` block, and so do overlapping OWNER and PREVIOUS_OWNER rows for the same customer.
- PREVIOUS_OWNER needs `valid_to`, on or before today (API) or the cutover date (import).
- Every write takes a per-vehicle row lock inside its transaction (a typed `UPDATE` of the vehicle row, which holds the row lock until commit) and rechecks the timeline under it. The partial unique index is the backstop; a violation maps to the same `409` overlap error.
- Future-dated OWNER, BILL_TO or LEASING rows are rejected (`422`; the importer reports `MIGRATION_UNSUPPORTED_CAPABILITY`) until a follow-up adds scheduled activation. Effective parties are computed at read time; `customer_id` is synced at write time only for an OWNER active today. Other roles may start in the future.
- Ending the owner never clears `customer_id`. Setting `customer_id` through `PATCH /vehicles/:id` to a different customer ends the active OWNER (valid_to = today) and starts a new OWNER (source `MANUAL`, valid_from = today) in the same transaction; repeating the current customer changes nothing. An OWNER that started today cannot end today (the interval would be empty), so a `MANUAL` one is corrected in place (or withdrawn when the contact is cleared); an imported one returns `409`. `null` ends the OWNER only. Vehicle create with a `customer_id` starts the first OWNER.
- One owner write path (AUT-697): every code path that changes the owner of a vehicle calls `setOwnerInTx(tx, ctx, vehicleId, customerId | null, source)` of the party writer inside its own transaction. It takes the per-vehicle row lock, ends the active OWNER (valid_to = today), starts the new OWNER with the given `source` (valid_from = today) and sets `customer_id`; the same customer changes nothing, `null` ends the OWNER and starts none. Callers: `PATCH /vehicles/:id` and vehicle create (`MANUAL`), the vehicle sale on finalize (`MANUAL`), registration intake (new vehicle and ownership correction, `MANUAL`), the workshop intake vehicle helper (`MANUAL`), taking a customer's vehicle into dealer stock on purchase receive (`null`) and the `vehicles.csv` import on CREATE (`LEGACY_IMPORT`). A jest guard (`vehicle-customer-id-writes.guard.spec.ts`) fails when a Vehicle create/update/upsert outside the party writer carries `customer_id`. Only the OWNER changes: a vehicle sale does not end BILL_TO or LEASING parties.
- Existing data is not backfilled. A vehicle with a main contact but no OWNER party keeps working through the read-time fallback. `findVehicleOwnerMismatches(db, tenantId, today)` (`vehicle-owner-mismatch.query.ts`) is a read-only query that lists the tenant's vehicles whose active OWNER differs from `customer_id` (including a main contact without an OWNER party, `owner_customer_id` null). It has no HTTP endpoint.
- Consequences to know: taking a customer's vehicle into stock on the day the customer became its manual OWNER withdraws that OWNER row instead of ending it (the same-day rule above). A `vehicles.csv` CREATE with an owner starts an OWNER dated the import day (`LEGACY_IMPORT`). A later `vehicle_parties.csv` row adopts it instead of overlapping it when it is an open OWNER row (no `valid_to`) for the same customer that starts on or before that day and the stored OWNER has source `LEGACY_IMPORT` and no external id yet: the party's `valid_from` moves to the file's day (UPDATE, no new row, `customer_id` unchanged) and the row's external id maps to it. Another customer, a closed row or a `MANUAL` owner still returns `VEHICLE_PARTY_OVERLAP`.
- The `vehicles.csv` import applies the owner on CREATE only. UPDATE rows never applied the owner (the flag is dropped before the update is built); that behavior is unchanged.

## API

All routes are tenant-wide; they grant no site rights. Writes need OWNER, ADMIN or SALES.

| Route | Result |
|---|---|
| `GET /vehicles/:vehicleId/parties` | Every party with history and customer summary, newest first, plus `suggested_bill_to`. |
| `POST /vehicles/:vehicleId/parties` | Adds a party (`customer_id`, `role`, optional `valid_from`, `valid_to`, `notes`). |
| `PATCH /vehicles/:vehicleId/parties/:partyId` | Ends an open-ended party (`valid_to`, default today). |
| `GET /vehicles/:id` | Adds `parties` (active today) and `open_due_dates` (open `SERVICE_DUE` notices). |
| `GET /customers/:id` | Adds `vehicle_parties` (vehicles by role, with history). |
| `GET /vehicles/:vehicleId/inspection-records` | Shows `source: LEGACY_IMPORT`; such rows are immutable (403 on PATCH and DELETE), like `EBV_IMPORTED`. |

`suggested_bill_to` is a read-only payer hint: the active BILL_TO, else the active LEASING, else `null`. The owner is never a fallback; with no BILL_TO and no LEASING the intake falls back to the order customer's own default bill-to. Nothing writes `WorkshopOrder.bill_to_customer_id` here.

Deleting a customer that a party references returns `409`.

HTTP errors carry a stable `code` next to the message. The web app maps each code to DE/EN copy in `locales/*/errors.json`.

| Code | Status | Thrown by |
|---|---|---|
| `VEHICLE_PARTY_WRITE_FORBIDDEN` | 403 | party writes by a role other than OWNER, ADMIN or SALES |
| `VEHICLE_PARTY_OVERLAP` | 409 | overlapping interval for the same role (also the partial unique index backstop) |
| `VEHICLE_PARTY_ALREADY_ENDED` | 409 | ending a party that already has an end date |
| `VEHICLE_PARTY_OWNER_IMPORTED_TODAY` | 409 | changing an OWNER that an import assigned today |
| `VEHICLE_PARTY_INTERVAL_INVALID` | 422 | `valid_from` not before `valid_to` |
| `VEHICLE_PARTY_PREVIOUS_OWNER_END_REQUIRED` | 422 | PREVIOUS_OWNER without an end date up to today |
| `VEHICLE_PARTY_FUTURE_START_UNSUPPORTED` | 422 | future-dated OWNER, BILL_TO or LEASING |
| `CUSTOMER_HAS_VEHICLE_PARTIES` | 409 | customer delete while a party references the customer |
| `CUSTOMER_HAS_ACTIVE_REFERENCES` | 400 | customer delete with orders or invoices |
| `CUSTOMER_HAS_VEHICLES` | 400 | customer delete with linked vehicles |
| `CUSTOMER_RETENTION_BLOCKS_DELETE` | 400 | customer delete while consent or contact preferences are retained |

The codes are listed in `CLIENT_SAFE_HTTP_ERROR_CODES`, otherwise the global filter drops them. Import row issues keep their codes (`VEHICLE_PARTY_OVERLAP`, `IMPORT_UNKNOWN_VEHICLE` and so on); they are row labels, not HTTP errors.

## Import

`VEHICLE_PARTY` (`vehicle_parties.csv`) and `VEHICLE_DUE_DATE` (`vehicle_due_dates.csv`) use the canonical 1.1 columns and run through the normal dry-run and apply flow. Vehicles and customers must already be imported; an unknown external id is a row error. Replay is a no-op through `ExternalIdMapping`. The cutover date comes from the manifest when one is supplied, otherwise today.

- Parties: the file is checked against itself and the untouched target parties. An owner transfer is an UPDATE that ends the old interval plus a CREATE for the new owner; updates apply first. Blank cells never clear a stored value. A changed vehicle, customer or role on a mapped id blocks. An active OWNER that differs from a main contact without an OWNER party is a reconciliation conflict.
- `INSPECTION_57A` creates a `VehicleInspectionRecord` (`PICKERL_57A`, `LEGACY_IMPORT`) with no `ExternalInspectionResult` and no tolerance months. It appears in the Pickerl due list. Evidence is immutable: a changed replay blocks. The optional report reference is checked for uniqueness per vehicle but has no target column.
- `SERVICE` creates one `OPEN` `SERVICE_DUE` notice (title `Service`, `LEGACY_IMPORT`). `external_ref` is required and unique per vehicle; a natural-key match without a mapping is a conflict. A locally resolved notice is never reopened or overwritten.

## UI (vehicle and customer screens)

- Vehicle detail shows a "Parties" card: the main contact (the active OWNER, else `Vehicle.customer_id` without a backfill and with a hint), the active parties by role, and a collapsible history that includes previous owners. Users with OWNER, ADMIN or SALES can add a party (role, customer, optional start day) and end an active one; other roles see the lists only. After a write the vehicle and customer caches are invalidated, so the main contact refreshes.
- Vehicle detail shows the open due dates (`open_due_dates`) read only. Creating and resolving them is AUT-642.
- The Pickerl record list labels `LEGACY_IMPORT` records "Altdaten-Import". The record table has no edit or delete actions, so imported records are immutable in the UI as well as in the API.
- The customer vehicles tab lists vehicles by party role with validity and an active or ended status. Deleting a customer shows the translated message for each delete code above.
- The intake dialog does not show `suggested_bill_to` yet. The API field is available; the payer selection and `WorkshopOrder.bill_to_customer_id` stay out of scope (AUT-638, AUT-640, AUT-646).

## MCP (read only)

`get_vehicle` carries `parties` and `open_due_dates`. `get_vehicle_context` has two new tenant-wide sections: `parties` (active parties with role, customer, validity) and `due_dates` (current `pickerl_due` and the open service-due notices). There is no MCP write for either.

## Not in this slice

Notice create, resolve, the open-notices list and import (AUT-642), payer selection and split invoicing (AUT-638, AUT-640, AUT-646), scheduled activation of future-dated parties, reminders and notifications.
