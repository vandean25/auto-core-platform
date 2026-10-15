---
title: "NoVA EU-M1 used import (slice EU-M1-2024)"
date: "2026-10-15"
module: "Vehicle"
status: draft
linear-project: "Austria Market Roadmap"
linear-milestone: "E4 — NoVA import workflows"
tags:
  - feature-spec
  - vehicle
  - finance
  - tax
---

# NoVA EU-M1 used import (slice EU-M1-2024)

## Summary

> Dealers at the pilot customer need a NoVA figure for one narrow case: a class M1 car already registered in the EU or EEA, brought in directly, whose first EU registration fell in calendar year 2024, and whose Austrian tax event falls on or after that registration and no later than 31 December 2026. The current calculator prices that car with the tariff of the tax-event date and only warns that Wertentwicklung was skipped. This spec defines slice `EU-M1-2024` so the engine selects tariff `at-m1-2024` from the first EU registration, applies one explicit value basis, and refuses every other historical case without returning an amount.

The normative machine contract is [`fixtures/nova-eu-used-import/cases.json`](fixtures/nova-eu-used-import/cases.json). Figures below match that file. `numberOrigin: "synthetic"` rows are illustrations for this slice. They are not independent validation. `numberOrigin: "published"` rows reproduce the BMF worked example and are the only independent numeric check; this slice refuses them because their tariff is not loaded.

---

## User Stories

- As an **accountant at the pilot customer**, I want an M1 EU used import from 2024 priced on the 2024 tariff and an explicit Wertentwicklung basis so that a 2026 registration is not silently priced on the 2026 tariff.
- As a **developer implementing AUT-530**, I want every supported and refused input in `cases.json` so that an unsupported year cannot return `novaAmountEuro`.

---

## Current state (verified 2026-10-15)

Verified against `apps/core-api/src/nova-calculator/types.ts`, `tariff-table.ts`, `calculate-nova.ts`, and `apps/core-api/src/vehicle/nova-calculation.service.ts` on `origin/main`. No product code changes in this issue.

| Behavior | Where | What the code does |
|----------|--------|--------------------|
| Tariff selection | `NovaCalculationService.calculate` | Calls `resolveTariffVersion(vehicleClass, taxableEventDate)` only. `firstRegistrationDate` is not a selection input. |
| Missing event-date row | same method | Throws `UNKNOWN_TARIFF_VERSION`, mapped to HTTP 422. |
| First registration | `calculateNova` | When `firstRegistrationDate` is present, appends warnings `wertentwicklung_not_applied` and `eu_import_tariff_hint`, then still computes the amount on the caller-supplied tariff. |
| Registration outside that row | `calculateNova` | Also appends `tariff_outside_registration_date`. The amount is unchanged. |
| Scope flag | `NovaCalculationService` | Those two warnings set `hasScopeLimitations`. They are not in `UNVERIFIED_WARNINGS`. |
| Table coverage | `NOVA_TARIFF_TABLE` | `passenger_z3` rows run from `at-m1-2021-h2` (`2021-07-01` .. `2021-12-31`) through `at-m1-2029` (`2029-12-31`). There is no row for 2014–2019 or for 2020-01-01 .. 2021-06-30. `source_retrieved` on every row is `2026-10-02`. |
| Vehicle class from stock | `mapVehicleValues` | `Vehicle.nova_class` is `NOT_SET`, `STANDARD`, `ELECTRIC_EXEMPT`, or `OTHER`. It is not an engine class. Unless the request sends `vehicleClass`, the service uses `passenger_z3`. |

The service spec `marks scope limitations when Wertentwicklung is not applied` sends `firstRegistrationDate: 2020-01-01` and `taxableEventDate: 2026-05-01` and expects a calculated amount plus those warnings. That test documents today's preview. It is not evidence that EU used import is implemented.

`POST /api/vehicles/nova/calculate` (`VehicleController`, global prefix `api`) is tenant-authenticated and read-only. With `vehicleId`, the service loads the vehicle in the authenticated tenant and, for dealer stock, on the active site's vehicle lot. An omitted `taxableEventDate` becomes today's `Europe/Vienna` calendar date.

---

## Scope

### In scope (AUT-519)

This issue delivers the spec and `cases.json` only.

### In scope for the follow-up implementation (AUT-530)

One slice, id `EU-M1-2024`:

| Bound | Value |
|-------|--------|
| `importMode` | `eu_used_m1` |
| Legal pattern | Direct import from an EU member state or an EEA state of an M1 vehicle already registered in that area. Same BMF formula for both. |
| `vehicleClass` | `passenger_z3` only |
| `driveType` | `ICE` only |
| `emissionCycle` | `WLTP` combined grams, supplied by the caller. Integer grams only. |
| `firstRegistrationDate` | `2024-01-01` through `2024-12-31` inclusive. This is the first registration in the rest of the EU or EEA, not the Austrian registration. |
| `taxableEventDate` | On or after `firstRegistrationDate`, and on or before `2026-12-31`. Austrian Zulassung, or the dealer's taxable delivery of that same import. The caller names the date. The engine does not choose it. |
| Tariff | `at-m1-2024` selected by `firstRegistrationDate` |
| Value basis | `known_new_net` or `achtelung`, required |

The 2024 M1 parameters below were re-read from the BMF 2021–2025 page on 2026-10-15 and match the existing `at-m1-2024` row: deduction 97 g, divisor 5, maximum 80 percent, malus €80 per g above 155 g, flat deduction €350, WLTP.

### Explicitly out of scope

| Item | Why it is refused or left alone |
|------|----------------------------------|
| All other classes | `n1_legacy_z6`, `motorcycle_z1_z2`, campers (`isCamperSA`), goods vehicles |
| All other first-registration years | Including years that already have a tariff row (`2021-07-01` .. `2023-12-31` and `2025-01-01` .. `2029-12-31`) and years before the table |
| Tax events after `2026-12-31` | A 2024 registration with a 2027 event is a later slice |
| BEV, FCEV, PHEV, `OTHER` | Zero-emission exemption and weighted PHEV stay on the v1 preview |
| NEDC and the ×1.27 factor, 2×kW, motorcycle hubraum | Not accepted in this mode |
| Third-country import, previously exempt domestic use, Ukraine displaced-person rule, Übergang § 6 Abs. 7 | Other BMF patterns. `third_country` and `previously_exempt` return `UNSUPPORTED_IMPORT_MODE` |
| NOVA 1 / NOVA 2 filing, Genehmigungsdatenbank, approval workflow | [AUT-531](https://linear.app/auto-core-platform/issue/AUT-531) |
| Invoice snapshot, valuation-list lookup, automatic tax return | The caller passes the current net base. The engine does not call Eurotax or FinanzOnline |
| Changing the v1 preview | A request with no `importMode`, no `valueBasis`, and no `originalNewNetEuro` keeps today's event-date calculation and warnings |

No Steuerberater or manufacturer approval gate is added. The decisions in this document are the engineering contract for the slice.

---

## Sources

Retrieved **2026-10-15**. "Source version" is the page's own *Letzte Aktualisierung* stamp. There is no separate statute consolidation id on these pages.

| Role | Source id | Source version | URL |
|------|-----------|----------------|-----|
| Tax event vs first EU registration; Wertentwicklung (known new net and Achtelung); published 2019 worked example | `bmf-nova-steuersatz` | 30. Juli 2026 | [NoVA Steuersatz](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz.html) |
| Historical tariff for first registration in 2024 (`at-m1-2024`) | `bmf-rechtslage-2021-07-01-bis-2025-06-30` | 1. Jänner 2026 | [Rechtslage 1. Juli 2021 – 30. Juni 2025](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_von_1_juli_2021_bis_30_Juni_2025.html) |
| Tariff parameters implied by the published 2019 example. Not loaded into `NOVA_TARIFF_TABLE` | `bmf-rechtslage-2014-03-01-bis-2019-12-31` | 1. Jänner 2026 | [Rechtslage 1. März 2014 – 31. Dezember 2019](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_von_1_maerz_2014_bis_31_dezember_2019.html) |

The lowercase URL `.../rechtslage_von_1_juli_2021_bis_30_juni_2025.html` returned HTTP 404 on 2026-10-15. The engine constant uses `30_Juni_2025`, which resolved. AUT-530 must keep that URL.

The 2014–2019 page is NEFZ-native: `(CO₂ − 90) / 5`, cap 32 percent, malus €20 per g above 250 g. The Abzug is not one number for the whole period (2014 depends on fuel, 2015 is €400, from 2016 it is €300). The published example uses €300, which matches a March 2019 registration. That is why this slice does not add a single pre-2021 row.

---

## Rule matrix

Rows are evaluated in the order in [Rejection order](#rejection-order). The first matching refusal wins. A successful row is reached only when every earlier gate passes.

| First EU registration | Tax event (Steuertatbestand) | Value basis (Wertbasis) | Vehicle class | Response |
|-----------------------|------------------------------|-------------------------|---------------|----------|
| `2024-01-01` .. `2024-12-31` | On or after that registration and on or before `2026-12-31` | `known_new_net` and `originalNewNetEuro` > 0 | `passenger_z3` | HTTP 200. Tariff `at-m1-2024`. Factor = current net / original new net. Malus and Abzug are scaled. The CO₂ percent is not scaled. |
| Same registration window | Same event window | `achtelung` | `passenger_z3` | HTTP 200. Tariff `at-m1-2024`. Factor = `(8 − min(completedYears, 7)) / 8`. |
| Same registration window | Same event window | Field absent | `passenger_z3` | HTTP 422 `MISSING_VALUE_DEVELOPMENT`. No amount. |
| Same registration window | Same event window | `known_new_net` without a positive original new net | `passenger_z3` | HTTP 422 `MISSING_ORIGINAL_NEW_NET`. No amount. |
| Same registration window | Same event window | Any other string | `passenger_z3` | HTTP 422 `INVALID_VALUE_BASIS`. No amount. |
| Before `2021-07-01` | Any later valid ISO date | Any, including absent | `passenger_z3` | HTTP 422 `UNSUPPORTED_HISTORICAL_TARIFF`. No amount. Covers the published 2019 example and any synthetic date before the table. |
| Inside the table but not in 2024 (`2021-07-01` .. `2023-12-31` or `2025-01-01` .. `2029-12-31`) | Any | Any | `passenger_z3` | HTTP 422 `OUTSIDE_SUPPORTED_SLICE`. Do not select that year's row and do not fall through to the event-year row. |
| In 2024 | Before the registration | Any | `passenger_z3` | HTTP 422 `INVALID_IMPORT_DATES`. |
| In 2024 | After `2026-12-31` | Any | `passenger_z3` | HTTP 422 `OUTSIDE_SUPPORTED_SLICE`. |
| Any | Any | Any | Missing | HTTP 422 `MISSING_VEHICLE_CLASS`. |
| Any | Any | Any | `n1_legacy_z6` or `motorcycle_z1_z2` | HTTP 422 `UNSUPPORTED_IMPORT_CLASS`, even when the registration is also before the table. |

Differing registration and event years are a success when both dates sit in the windows above. The tariff id remains `at-m1-2024`. Completed years for Achtelung follow registration anniversaries, not `eventYear − registrationYear`. `known_new_net` does not use the year count as a second discount; the response still reports `fullYearsElapsed`.

---

## Calculation

Used only after the rejection order reaches a success.

1. `effectiveCo2` is the integer WLTP `co2GramsPerKm`. No ×1.27 and no 2×kW.
2. `rateRaw = (effectiveCo2 − 97) / 5`. `ratePercent = min(80, max(0, roundToWholePercent(rateRaw)))` using the existing `roundToWholePercent` (half-up for non-negative rates via `Math.round`).
3. `baseAmountEuro = roundMoneyEuro(netPriceEuro × ratePercent / 100)` using the existing `roundMoneyEuro`.
4. `malusGrossEuro = max(0, effectiveCo2 − 155) × 80`. `deductionGrossEuro = 350`. `fixedBeforeDevelopmentEuro = malusGrossEuro − deductionGrossEuro`.
5. Value development scales only `fixedBeforeDevelopmentEuro`.
   - `known_new_net`: factor = `netPriceEuro / originalNewNetEuro`. The ratio is not capped at 1. A current net above the original new net increases the malus/Abzug block.
   - `achtelung`: completed years are the largest integer `n ≥ 0` such that the registration date plus `n` calendar years is on or before the tax event. If the day does not exist (29 February), clamp to the last day of that month. `n` for the factor stops at 7: retained eighths = `8 − min(n, 7)`. Inside this slice `n` is 0, 1, or 2, so the seven-year floor is specified and is not hit by a 200 response. The published 2019 example is the independent check of that floor, and this slice refuses to execute it.
6. `fixedAfterDevelopmentEuro = roundMoneyEuro(fixedBeforeDevelopmentEuro × factor)`.
7. `novaAmountEuro = max(0, baseAmountEuro + fixedAfterDevelopmentEuro)`. Both inputs are already cent-rounded, so the sum is in cents. A negative sum becomes `0.00` and adds rule `tariff.no_tax_credit_floor`.

`netPriceEuro` is the current net Bemessungsgrundlage the caller already decided (Gemeiner Wert without VAT, or the dealer's net acquisition price). The engine does not classify which of those two the caller used.

### Worked synthetic success (not independent validation)

`synthetic-eu-m1-2024-known-new-net-cross-year`: registration `2024-06-01`, event `2026-06-01`, WLTP 160 g, current net €20,000.00, original new net €40,000.00.

| Step | Value |
|------|--------|
| Tariff | `at-m1-2024` (not `at-m1-2026`) |
| Rate | `(160 − 97) / 5 = 63/5` → 13% |
| Base | €2,600.00 |
| Malus | `(160 − 155) × 80 = €400.00` |
| Abzug | €350.00 |
| Fixed before development | €50.00 |
| Completed years | 2 (reported, not applied as a second factor) |
| Factor | `20000/40000` |
| Fixed after development | €25.00 |
| NoVA | **€2,625.00** |

The same inputs on today's v1 path would select `at-m1-2026` because the event is in 2026: `(160 − 91) / 5` rounds to 14%, base €2,800.00, unscaled fixed part €50.00, amount **€2,850.00**, plus `wertentwicklung_not_applied`. Leaving the 2024 malus and Abzug unscaled would yield **€2,650.00**. Both figures are forbidden for this request.

The Achtelung twin (`synthetic-eu-m1-2024-achtelung-two-years`) uses factor `6/8` and yields **€2,637.50**. Registration `2024-06-01` and event `2025-05-31` are different calendar years with **zero** completed anniversaries, factor `8/8`, amount **€2,650.00**.

---

## Reference corpus

### Published example (independent arithmetic, refused by this slice)

Source section: *Fahrzeugimport aus Mitgliedstaaten der EU*, page `bmf-nova-steuersatz`, retrieved 2026-10-15. The page's hypothetical person A imports an M1 from Germany. First registration in Germany **7 March 2019**. Austrian registration **in June 2026**. The page does not name the day; the fixture pins `taxableEventDate` to `2026-06-15`. Seven completed years run from `2026-03-07` through `2027-03-06`. Current net value on an Austrian valuation list **€8,000**. The page is not a pilot customer record.

| Intermediate | Neuwagenwert known | Neuwagenwert unknown (Achtelung) |
|--------------|--------------------|----------------------------------|
| CO₂ | NEFZ 270 g/km, not ×1.27 | same |
| Rate | `(270 − 90) / 5 = 36%`, cap **32%** | same |
| Base | `8000 × 32% = €2,560.00` | same |
| Malus | `(270 − 250) × €20 = €400.00` | same |
| Abzug | €300.00 | same |
| Fixed before development | €100.00 | same |
| Factor | `8000/28500`, printed by BMF as 28.07% | 7 completed years → `1/8` = 12.50% |
| Fixed after development | €28.07 | €12.50 |
| NoVA | **€2,588.07** | **€2,572.50** |

`roundMoneyEuro(100 × 8000 / 28500)` is €28.07, which matches the printed euro result. Cent rounding of the exact ratio is the contract. The printed "28,07 Prozent" is the page's display of that same result.

Slice response for both published requests: HTTP 422 `UNSUPPORTED_HISTORICAL_TARIFF`. The body is `{ code, message }` only. `publishedArithmetic` in `cases.json` records the table above with `executedBySlice: false`. AUT-530 must not assert those euro amounts as the HTTP body.

### Synthetic rows

Every other case in `cases.json` has `numberOrigin: "synthetic"` and `independentValidation: false`. They fix the slice contract. They do not validate the 2024 tariff against an external worked example. Party label, where a party is named, is **pilot customer**.

---

## Rejection order

When `importMode` is present, apply the first match. Do not call `calculateNova` on a refusal. Do not default a missing date to today. Do not read `Vehicle.nova_class` as the engine class.

1. `importMode` other than `eu_used_m1` → `UNSUPPORTED_IMPORT_MODE`.
2. `valueBasis` or `originalNewNetEuro` present while `importMode` is absent → `MISSING_IMPORT_MODE`. This is the only change visible to a v1 client, and only if they send the new fields.
3. Missing or non-ISO `firstRegistrationDate` → `MISSING_FIRST_REGISTRATION` or `INVALID_ISO_DATE`. Missing or non-ISO `taxableEventDate` → `MISSING_TAXABLE_EVENT_DATE` or `INVALID_ISO_DATE`.
4. Tax event before first registration → `INVALID_IMPORT_DATES`.
5. `vehicleClass` absent → `MISSING_VEHICLE_CLASS`. Any other class → `UNSUPPORTED_IMPORT_CLASS`.
6. `firstRegistrationDate < 2021-07-01` → `UNSUPPORTED_HISTORICAL_TARIFF`.
7. Registration outside 2024, or tax event after `2026-12-31` → `OUTSIDE_SUPPORTED_SLICE`.
8. `driveType` other than `ICE`, including absent → `UNSUPPORTED_DRIVE_TYPE`.
9. `emissionCycle` other than `WLTP`, including absent → `UNSUPPORTED_EMISSION_CYCLE`.
10. `isCamperSA === true` → `UNSUPPORTED_CAMPER_SA`.
11. `co2GramsPerKm` absent → `MISSING_CO2`. Non-finite or negative → `INVALID_CO2`. Not an integer → `UNSUPPORTED_FRACTIONAL_CO2`. `ratedPowerKw` and `displacementCc` are ignored and never become a substitute.
12. `netPriceEuro` fails the existing non-negative finite check → `INVALID_NET_PRICE`.
13. `valueBasis` absent → `MISSING_VALUE_DEVELOPMENT`. Present and not one of the two literals → `INVALID_VALUE_BASIS`. `known_new_net` without `originalNewNetEuro` finite and `> 0` → `MISSING_ORIGINAL_NEW_NET`.
14. Compute the success body.

A date before the table therefore returns `UNSUPPORTED_HISTORICAL_TARIFF` even when `emissionCycle` is `NEDC` or `valueBasis` is missing, as long as the class is `passenger_z3`. The published example takes this path. A 2024 registration with `NEDC` returns `UNSUPPORTED_EMISSION_CYCLE` and must not multiply by 1.27.

### Error catalog

HTTP 422 body matches the existing `NovaCalculationErrorResponseDto`: `code` and `message` only. `novaAmountEuro` is absent. New messages:

| Code | Message |
|------|---------|
| `MISSING_IMPORT_MODE` | `valueBasis and originalNewNetEuro require importMode eu_used_m1` |
| `MISSING_FIRST_REGISTRATION` | `eu_used_m1 requires firstRegistrationDate` |
| `MISSING_TAXABLE_EVENT_DATE` | `eu_used_m1 requires taxableEventDate` |
| `INVALID_IMPORT_DATES` | `taxableEventDate must be on or after firstRegistrationDate` |
| `MISSING_VEHICLE_CLASS` | `eu_used_m1 requires vehicleClass` |
| `UNSUPPORTED_IMPORT_MODE` | `importMode is not supported` |
| `UNSUPPORTED_IMPORT_CLASS` | `eu_used_m1 slice EU-M1-2024 accepts only vehicleClass passenger_z3` |
| `UNSUPPORTED_HISTORICAL_TARIFF` | `No passenger_z3 tariff row exists for firstRegistrationDate before 2021-07-01` |
| `OUTSIDE_SUPPORTED_SLICE` | `eu_used_m1 slice EU-M1-2024 accepts firstRegistrationDate in 2024 and taxableEventDate from that date through 2026-12-31` |
| `UNSUPPORTED_DRIVE_TYPE` | `eu_used_m1 slice EU-M1-2024 accepts only driveType ICE` |
| `UNSUPPORTED_EMISSION_CYCLE` | `eu_used_m1 slice EU-M1-2024 accepts only emissionCycle WLTP` |
| `UNSUPPORTED_CAMPER_SA` | `eu_used_m1 slice EU-M1-2024 does not accept isCamperSA` |
| `UNSUPPORTED_FRACTIONAL_CO2` | `eu_used_m1 slice EU-M1-2024 requires an integer co2GramsPerKm` |
| `MISSING_CO2` | `eu_used_m1 slice EU-M1-2024 requires co2GramsPerKm` |
| `MISSING_VALUE_DEVELOPMENT` | `eu_used_m1 requires valueBasis known_new_net or achtelung` |
| `INVALID_VALUE_BASIS` | `valueBasis must be known_new_net or achtelung` |
| `MISSING_ORIGINAL_NEW_NET` | `known_new_net requires originalNewNetEuro greater than zero` |

`INVALID_ISO_DATE`, `INVALID_CO2`, and `INVALID_NET_PRICE` keep their existing messages. `UNKNOWN_TARIFF_VERSION` and `TARIFF_CLASS_MISMATCH` are v1 codes. This mode must not use them to express a missing historical row or a class outside the slice.

### Success body

Existing fields stay. Additions:

| Field | Value |
|-------|--------|
| `tariffVersionId` | `at-m1-2024` |
| `tariffSelectionBasis` | `first_eu_registration` |
| `tariffSelectionDate` | the request's `firstRegistrationDate` |
| `warnings` | `[]` |
| `hasUnverifiedRules` | `false` |
| `hasScopeLimitations` | `false` |
| `intermediates` | `rateRaw` as an unreduced fraction string, cent strings for money, `fullYearsElapsed`, `valueDevelopmentFactor` as `{ numerator, denominator }`, `valueBasis` |

`appliedRuleIds`, in this order, including a rule only when it applies:

1. `import.eu_used_m1.slice_2024`
2. `tariff.selected_by_first_eu_registration`
3. `tariff.co2_rate_formula`
4. `tariff.rate_floor_zero` when `rateRaw < 0`
5. `tariff.max_rate_cap` when the rounded percent exceeds 80
6. `tariff.base_on_net_price`
7. `tariff.malus_per_gram` when `malusGrossEuro > 0`
8. `tariff.flat_deduction`
9. `wertentwicklung.known_new_net` or `wertentwicklung.achtelung`
10. `tariff.no_tax_credit_floor` when the sum before the floor is negative

Do not emit `wertentwicklung_not_applied`, `eu_import_tariff_hint`, or `tariff_outside_registration_date` on this path.

### vehicleId

Tenant and active-site checks stay as they are in `NovaCalculationService.calculate`. For `importMode: eu_used_m1` the request must still send `vehicleClass`, `driveType`, `emissionCycle`, `taxableEventDate`, `netPriceEuro`, and `valueBasis`. `firstRegistrationDate` and `co2GramsPerKm` may be filled from `Vehicle.first_registration_date` and `Vehicle.co2_wltp_g_km` only when the request omits them. A stored NEDC value is not a substitute: missing WLTP grams is `MISSING_CO2`. The response does not gain a persistence id.

---

## Database Impact

### New Tables / Columns

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
| None | | | | The slice is a pure function of the request. No Prisma model. |

### Modified Tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
| None | No column, index, or relation | No |

### Deletion Policy Impact

No new entity. `docs/deletion-policy.md` stays unchanged. The calculation is not stored, so there is no delete, soft-delete, or retention row. Vehicle deletion rules are untouched.

### State machines, inventory, fiscal lock, realtime

No status is added. No `InventoryTransaction` is written. The slice does not post an invoice or a tax filing, so `FinanceSettings.lock_date` does not apply. Do not add the result to `SUPPORTED_ENTITY_TYPES` or `dashboard-entity-map.ts`.

---

## API Contract Changes

Implemented in AUT-530, not in this spec PR.

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| None | | | | |

### Modified Endpoints

| Method | Route | Change Description |
|--------|-------|--------------------|
| POST | `/api/vehicles/nova/calculate` | Optional `importMode`, `valueBasis`, `originalNewNetEuro`. When `importMode` is `eu_used_m1`, the success body gains `tariffSelectionBasis`, `tariffSelectionDate`, and `intermediates`. Refusal codes above join `NovaCalculationErrorCode` and the Swagger enum. V1 responses omit the new fields. |

Minimal JSON request for a calculation without `vehicleId`:

```json
{
  "importMode": "eu_used_m1",
  "vehicleClass": "passenger_z3",
  "driveType": "ICE",
  "emissionCycle": "WLTP",
  "co2GramsPerKm": 160,
  "firstRegistrationDate": "2024-06-01",
  "taxableEventDate": "2026-06-01",
  "netPriceEuro": 20000,
  "valueBasis": "known_new_net",
  "originalNewNetEuro": 40000
}
```

### OpenAPI Regeneration

AUT-530 runs both commands and commits both artifacts. This spec PR does not change DTOs, so it does not run them.

- `npm --prefix apps/core-api run openapi:generate`
- `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

Not applicable. AUT-519 and AUT-530 add no page, list, dialog, or form. No top-right action, DataTable, StatusBadge, auto-save, or realtime query key changes. A later UI spec would have to send `importMode` explicitly; it must not present the v1 warning path as this slice.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| None | | No React component in this slice. |

AUT-530 edits the existing Nest service and the pure calculator only:

| Module | Change |
|--------|--------|
| `apps/core-api/src/nova-calculator/` | Slice function. Does not extend v1 `calculateNova` to scale Wertentwicklung as a silent extra. |
| `apps/core-api/src/vehicle/nova-calculation.service.ts` | Branch on `importMode` before `resolveTariffVersion(eventDate)`. |
| `apps/core-api/src/vehicle/dto/nova-calculate.dto.ts` | New optional fields and error enum. |

---

## Testing Plan

### Backend

AUT-530 loads `docs/internal/02-Feature-Specs/Vehicles/fixtures/nova-eu-used-import/cases.json` and asserts HTTP status, error code, message, success body, and each `mustNot` list. A refusal fixture fails if the body contains `novaAmountEuro`. Existing v1 tests stay green, including the 2020-01-01 warning test, because that request has no `importMode`.

### Frontend

No visual QA. No web client change.

---

## Implementation slices

| Slice | Issue | Owner | Deliverable |
|-------|-------|-------|-------------|
| Spec and fixtures | [AUT-519](https://linear.app/auto-core-platform/issue/AUT-519) | Docs only. This PR. | This file and `cases.json` |
| Engine and API | [AUT-530](https://linear.app/auto-core-platform/issue/AUT-530) | `apps/core-api` vehicle and `nova-calculator` | Implement `EU-M1-2024` against `cases.json`. Regenerate OpenAPI and web types. |
| Filing and approval database | [AUT-531](https://linear.app/auto-core-platform/issue/AUT-531) | Separate issue | NOVA 2 draft and Genehmigungsdatenbank. Not designed here. |

No ADR. The slice does not add a table, a status machine, or a new integration. It is a gated branch on the existing calculate route.

---

## Open Questions

None. Date window, class, value basis, anniversary rule, uncapped known-net ratio, cent rounding, and refusal codes are closed above. A wider year range is a new slice with its own tariff source check, not a change to these fixtures.

---

## References

- [NoVA Calculator (AUT-376 / AUT-405)](nova-calculator.md)
- [AUT-519](https://linear.app/auto-core-platform/issue/AUT-519)
- [AUT-530](https://linear.app/auto-core-platform/issue/AUT-530)
- [AUT-531](https://linear.app/auto-core-platform/issue/AUT-531)
- [`cases.json`](fixtures/nova-eu-used-import/cases.json)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Austria Market Roadmap](https://linear.app/auto-core-platform/project/austria-market-roadmap-30062cc45fde) |
| Milestone | E4 — NoVA import workflows |
| Issues | AUT-519 (this spec), AUT-530 (implementation), AUT-531 (filing, out of scope) |
