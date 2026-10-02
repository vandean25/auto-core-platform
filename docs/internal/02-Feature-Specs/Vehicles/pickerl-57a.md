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

## Pinned rules (RIS primary)

Retrieval date for RIS URLs: **2026-10-02**.

| Rule ID | Description | Source |
|--------|-------------|--------|
| `kfg42-effective-date` | 42. KFG-Novelle entry into force **2027-05-19** | [RIS §57a (fassung ab 19.05.2027)](https://www.ris.bka.gv.at/eli/bgbl/1967/267/P57a/NOR40069745) |
| `anniversary-anchor` | Due month anchored to anniversary of first registration (also if registered abroad) | [RIS §57a Abs. 3](https://www.ris.bka.gv.at/eli/bgbl/1967/267/P57a/NOR40069745) |

## Pinned rules (WKO guidance — not RIS-verified in engine)

Retrieval date for WKO URLs: **2026-10-02**. The rule engine implements these tables but emits API warning `WKO_GUIDANCE_NOT_RIS_VERIFIED` (and rule-specific warnings below) because they are taken from WKO chamber guidance, not re-parsed from RIS text in code.

| Rule ID | Description | Source |
|--------|-------------|--------|
| `m1-legacy-intervals` | M1 (excl. taxi / ambulance): intervals **3–2–1–1…** | [WKO — Pickerl-Überprüfung §57a](https://www.wko.at/transport/pickerl-ueberpruefung-begutachtung-57a-kfg) |
| `m1-legacy-tolerance` | Tolerance **−1 / +4** months | Same WKO page |
| `m1-kfg42-intervals` | From **2027-05-19**: **4–2–2–2–1** for M1; applies to vehicles registered before that date | [WKO — Begutachtungstermine ab 2027](https://www.wko.at/paragraph-57a/begutachtungstermine) |
| `m1-kfg42-tolerance` | From **2027-05-19**: tolerance **−4 / +0** months | Same WKO page |
| `transition-2027-tolerance` | Due months **Jan–Oct 2027**: legacy **−1/+4** capped at end of **November 2027** (§132 Abs 37 Z 3 on WKO page) | Same WKO page |
| `austauschplakette-punching` | Punching hint: **Erstzulassung + 4 years** without periodic inspection on file; else **last inspection + 2 years** | Same WKO page (§4) |

## Vehicle classes

| Class | Engine support in AUT-377 | Notes |
|-------|---------------------------|-------|
| **M1** (ordinary Pkw) | **Yes** | Assumed for all vehicles until `vehicle_class` exists on `Vehicle` |
| M2, M3, N, O, L, taxis, historical, etc. | **Not supported yet** | Documented only; engine emits `VEHICLE_CLASS_ASSUMED_M1` until class is modeled |

## API warnings (emitted by rule engine)

| Warning code | When |
|--------------|------|
| `VEHICLE_CLASS_ASSUMED_M1` | Always (until `vehicle_class` exists) |
| `WKO_GUIDANCE_NOT_RIS_VERIFIED` | Always; interval/tolerance tables are WKO-sourced |
| `NO_INSPECTION_RECORDS` | No records and `onDate` is past the first-interval tolerance window |
| `TRANSITION_2027_TOLERANCE` | Due month is 2027-01 … 2027-10 (legacy tolerance with Nov 2027 cap; WKO-sourced) |
| `AUSTAUSCHPLAKETTE_NOT_TRACKED` | `onDate` ≥ 2027-05-19; message includes computed Austausch month per WKO §4 |

## Rule engine contract

```typescript
computePickerlDue(vehicle, records, onDate, ruleSetVersion?) => {
  due_month: 'YYYY-MM' | null,
  status: 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN',
  rule_id: string,
  warnings: { code: string; message: string }[],
}
```

- **UNKNOWN** when `first_registration_date` is missing, or when there are no inspection records and the first-interval window has elapsed.
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

Create/update validates: `inspected_on` not in the future; plakette due month not before inspection month.

## UX

- Vehicle detail: due month + status badge; UNKNOWN copy when Erstzulassung missing or no inspection captured.
- List of inspection records; **Pickerl erfasst** opens create dialog (hidden for TECH).

## Out of scope

- Notifications, email, SMS, campaigns (Epic 7 / AUT-374).
- ASFINAG / GIS integration.
- Workshop inspection templates (unchanged).
