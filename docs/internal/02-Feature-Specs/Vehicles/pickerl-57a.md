---
title: "Pickerl (§57a KFG) due-date tracking"
date: "2026-10-02"
module: Vehicle
status: draft
linear-project: "Austria Market Roadmap"
tags:
  - feature-spec
  - vehicle
  - pickerl
---

# Pickerl (§57a KFG) due-date tracking

## Summary

ACP records Austrian §57a periodic inspection (Pickerl) outcomes per vehicle and computes the next due calendar month and status (OK / DUE_SOON / OVERDUE / UNKNOWN). This slice is **data + rules only** — no reminders, outbound messages, or external integrations.

## Scope (AUT-377)

- Expand-only `VehicleInspectionRecord` tenant table.
- Pure `computePickerlDue(vehicle, records, onDate, ruleSetVersion?)` with versioned rule sets (`valid_from`).
- CRUD API on `/vehicles/:vehicleId/inspection-records`; `pickerl_due` on vehicle read.
- Minimal vehicle detail UI: history list + **Pickerl erfasst** dialog.

## Pinned rules (primary sources)

Retrieval date for all URLs below: **2026-10-02**.

| Rule ID | Description | Source |
|--------|-------------|--------|
| `m1-legacy-intervals` | M1 (excl. taxi / ambulance): intervals **3–2–1–1…** years from first registration anniversary / last inspection anniversary | [WKO — Pickerl-Überprüfung §57a](https://www.wko.at/transport/pickerl-ueberpruefung-begutachtung-57a-kfg) |
| `m1-legacy-tolerance` | Tolerance **−1 / +4** months relative to punched due month | Same WKO page (table) |
| `m1-kfg42-intervals` | From **2027-05-19**: M1 (excl. taxi / ambulance) **4–2–2–2–1** then annual | [WKO — Begutachtungstermine ab 2027](https://www.wko.at/paragraph-57a/begutachtungstermine) |
| `m1-kfg42-tolerance` | From **2027-05-19**: tolerance **−4 / +0** months | Same WKO page (table) |
| `kfg42-effective-date` | 42. KFG-Novelle entry into force **2027-05-19** | [RIS §57a (fassung ab 19.05.2027)](https://www.ris.bka.gv.at/eli/bgbl/1967/267/P57a/NOR40069745) |
| `anniversary-anchor` | Due month anchored to anniversary of first registration (also if registered abroad) | [RIS §57a Abs. 3](https://www.ris.bka.gv.at/eli/bgbl/1967/267/P57a/NOR40069745) |

## Vehicle classes

| Class | Engine support in AUT-377 | Notes |
|-------|---------------------------|-------|
| **M1** (ordinary Pkw) | **Yes** | Assumed for all vehicles until `vehicle_class` exists on `Vehicle` |
| M2, M3, N, O, L, taxis, historical, etc. | **Not supported yet** | API emits `VEHICLE_CLASS_NOT_SUPPORTED` warning |

## Unverified / partially modeled rules

These are documented here and surfaced as API `warnings` (not silent):

| Warning code | Topic | Notes |
|--------------|-------|-------|
| `VEHICLE_CLASS_ASSUMED_M1` | No `vehicle_class` on vehicle | Computation uses M1 ordinary Pkw rules only |
| `TRANSITION_2027_TOLERANCE` | Jan–Oct 2027 due months under old plakette | WKO describes extended **−1/+4** through Nov 2027 for certain months; engine applies a simplified transition flag when `onDate` is in 2027 and rule set is post-2027-05-19 |
| `AUSTAUSCHPLAKETTE_NOT_TRACKED` | Replacement sticker workflow | No data field for Austauschplakette issuance; due month still derived from records / intervals |
| `NON_M1_INTERVALS_UNVERIFIED` | Other WKO table rows | Not implemented in rule tables |

## Rule engine contract

```typescript
computePickerlDue(vehicle, records, onDate, ruleSetVersion?) => {
  due_month: 'YYYY-MM' | null,
  status: 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN',
  rule_id: string,
  warnings: { code: string; message: string }[],
}
```

- **UNKNOWN** when `first_registration_date` is missing.
- **Time injection**: `onDate` is required; no `Date.now()` inside the function.
- **Rule set selection**: explicit `ruleSetVersion` or auto by `onDate` vs `valid_from` (2027-05-19 boundary).

## Database

### `vehicle_inspection_records`

| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | UUID | Tenant isolation |
| `vehicle_id` | UUID | FK `vehicles` |
| `inspection_type` | enum | `PICKERL_57A` |
| `inspected_on` | date | Inspection date |
| `plaketten_valid_until_year` | int | Punched due year on sticker |
| `plaketten_valid_until_month` | int | 1–12 |
| `station_name` | text? | Optional Prüfstelle |
| `source` | enum | `MANUAL` |
| `notes` | text? | |
| `created_by_user_id` | UUID? | |

Index: `(tenant_id, vehicle_id, inspected_on)`.

## API

| Method | Route | Auth |
|--------|-------|------|
| GET | `/vehicles/:id` | Includes `pickerl_due` |
| GET/POST | `/vehicles/:vehicleId/inspection-records` | Write: OWNER, ADMIN, SALES (ADVISOR ≡ SALES until role exists); read includes TECH |
| GET/PATCH/DELETE | `/vehicles/:vehicleId/inspection-records/:recordId` | Same RBAC |

## UX

- Vehicle detail: due month + status badge; UNKNOWN copy when Erstzulassung missing.
- List of inspection records; **Pickerl erfasst** opens create dialog.

## Out of scope

- Notifications, email, SMS, campaigns (Epic 7 / AUT-374).
- ASFINAG / GIS integration.
- Workshop inspection templates (unchanged).
