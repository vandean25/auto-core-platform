---
title: "NoVA Calculator (Normverbrauchsabgabe)"
date: "2026-10-02"
module: "Vehicle"
status: draft
linear-issue: "https://linear.app/auto-core-platform/issue/AUT-376"
tags:
  - feature-spec
  - vehicle
  - finance
  - tax
---

# NoVA Calculator (Normverbrauchsabgabe)

## Summary

> Austrian dealers must calculate, collect, and remit **Normverbrauchsabgabe (NoVA)** on taxable vehicle transactions. This spec defines a **pure, deterministic calculation engine** driven by a **versioned tariff table** (`valid_from` / `valid_to`) so annual BMF/RIS parameter changes are **data**, not application code. **Phase 1 (this issue):** internal spec + engine module only — no Prisma/schema, API route, UI, or invoice line changes.

---

## User Stories

- As a **dealer accountant**, I want a **reproducible NoVA estimate** from CO₂, net price, drive type, and registration context so that **quotes and stock costing match FinanzOnline expectations**.
- As a **developer**, I want **tariff versions** pinned to legal validity periods so that **historical EU imports and used-car scenarios** use the correct rule set without redeploying formula code.
- As a **compliance owner**, I want every rule **sourced or marked UNVERIFIED** so that **Steuerberater can sign off** before production use on invoices.

---

## Scope

### In scope (AUT-376)

| Deliverable | Description |
|-------------|-------------|
| Feature spec | This document |
| Pure engine | `calculateNova(input, tariffVersion)` in `apps/core-api/src/nova-calculator/` |
| Tariff table | Versioned rows with `valid_from`, `valid_to`, vehicle class, CO₂ parameters |
| Unit tests | Table-driven; ≥30 boundary tests (threshold ±1, rounding, BEV exempt, missing CO₂ error) |

### Explicitly out of scope (follow-up tickets — do not implement here)

| Follow-up | Description |
|-----------|-------------|
| **API endpoint** | REST/OpenAPI `POST /vehicles/nova/calculate` (or finance module equivalent) |
| **Vehicle UI** | NoVA preview on vehicle stock / sale flows |
| **Invoice lines** | Snapshot NoVA on `InvoiceItem` / vehicle sale documents |
| **NOVA 1 export** | FinanzOnline / NOVA 1 filing payload generation |

---

## Legal sources (primary)

| Source | Role | Retrieved |
|--------|------|-----------|
| [NoVAG § 5 Bemessungsgrundlage (RIS)](https://www.ris.bka.gv.at/eli/bgbl/1991/695/P5/NOR40273768) | Tax base for delivery vs registration | 2026-10-02 |
| [NoVAG § 6 Tarif (RIS, konsolidiert)](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004698) | Formula, WLTP/NEFZ, Malus, Abzug, § 6 Abs. 8 used EU import | 2026-10-02 |
| [NoVAG § 3 Steuerbefreiungen (RIS)](https://www.ris.bka.gv.at/eli/bgbl/1991/695/P3/NOR40273766) | 0 g/km / Elektro & Wasserstoff | 2026-10-02 |
| [BMF NoVA Steuersatz (Übersicht)](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz.html) | Applicable law at event vs first registration; NEFZ×1,27; EU import Achtelung | 2026-10-02 |
| [BMF Rechtslage ab 1. Juli 2025](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_ab_1_juli_2025.html) | M1 / motorcycle tariff periods Jul 2025–Dec 2029 | 2026-10-02 |
| [BMF Rechtslage 1. Juli 2021 – 30. Juni 2025](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_von_1_juli_2021_bis_30_Juni_2025.html) | M1 / N1 annual slices 2021–H1 2025 | 2026-10-02 |
| [BMF NoVA Befreiungen](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-befreiung.html) | BEV/H₂ at delivery | 2026-10-02 |
| [BMF Erhebung der NoVA](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/erhebung-der-nova.html) | NOVA 1 deadline (Unternehmer) | 2026-10-02 |
| [USP Befreiungen](https://www.usp.gv.at/themen/steuern-finanzen/weitere-steuern-und-abgaben/normverbrauchsabgabe-nova/Befreiungen.html) | BEV not via Vergütung; hybrids not exempt | 2026-10-02 |
| [USP Fahrzeuglieferung im Inland](https://www.usp.gv.at/themen/steuern-finanzen/weitere-steuern-und-abgaben/normverbrauchsabgabe-nova/fahrzeuglieferung-im-inland.html) | NOVA 1 form for dealers | 2026-10-02 |

---

## Which legal snapshot applies

| Transaction pattern | Tariff snapshot | Primary source |
|--------------------|-----------------|----------------|
| **New domestic delivery** / **IG Erwerb** / **Drittland import (Händler)** | Law at **Tatbestandsverwirklichung** (delivery, IG acquisition, or registration as applicable) | BMF Steuersatz “Grundregelung” |
| **EU/EWR used import** (previously registered in Union) | Law that would have applied at **first registration in the Union**; Malus + €350 Abzug scaled by **Wertentwicklung** (ratio or Achtelung) | NoVAG § 6 Abs. 8; BMF Steuersatz “Fahrzeugimport aus Mitgliedstaaten” |
| **Previously NoVA-befreit**, now taxable | Law at **first (befreite) domestic registration**; same Wertentwicklung rules | BMF Steuersatz “Befreite Kraftfahrzeuge” |
| **Unwiderruflicher Kaufvertrag** before 1 Dec, delivery/IG before 1 Apr next year | May use tariff valid **until 31 Dec** of contract year | NoVAG § 6 Abs. 7 (Übergang); BMF “Übergangsregelung” |

**Engine v1:** implements **full formula** for a caller-selected `tariffVersion`. **Wertentwicklung** (§ 6 Abs. 8) and **Übergangsregelung** are specified here but **not computed in v1** — callers pass the resolved `tariffVersion` and net Bemessungsgrundlage; warnings flag when reduction is required.

---

## Tax base (Bemessungsgrundlage)

| Case | Base | Source |
|------|------|--------|
| Lieferung (§ 1 Z 1) / IG Erwerb (§ 1 Z 2) | **Entgelt** i.S.d. § 4 UStG 1994 (typically **net of VAT**) | NoVAG § 5 Abs. 1 |
| Zulassung / Eigenverbrauch / Nutzungsänderung (§ 1 Z 3, Z 4 lit. b/c) | **Gemeiner Wert** without VAT component; EU Händlerankauf → Anschaffungspreis | NoVAG § 5 Abs. 2 |
| NoVA on invoice | NoVA is **not** part of the VAT base | NoVAG § 5 Abs. 3 |

**Product input:** `netPriceEuro` = Bemessungsgrundlage in EUR (excl. USt). **Extras:** UNVERIFIED whether factory/dealer extras follow full UStG Entgelt rules — see Needs Steuerberater.

---

## CO₂ value and test cycle

| Rule | Detail | Source |
|------|--------|--------|
| Default metric | **Kombinierter WLTP** CO₂ g/km | NoVAG § 6 Abs. 4 |
| Plug-in hybrid | **Gewichtet kombinierter WLTP** | NoVAG § 6 Abs. 4; BMF tariff pages |
| Motorcycles | **WMTC** (separate tariff class) | NoVAG § 6 Abs. 4; BMF Jul 2025 page |
| NEFZ only | CO₂ may be taken as **1,27 × NEFZ** value | NoVAG § 6 Abs. 6 Z 2; BMF Steuersatz |
| No CO₂ on certificate | **2 × kW** (rated power); motorcycles: hubraum rule | NoVAG § 6 Abs. 6 |
| COC field 48 | WLTP vs NEFZ letter codes | BMF Steuersatz |

**Engine input:** `emissionCycle`: `WLTP` | `NEDC`. When `NEDC`, engine applies **×1.27** to entered CO₂ before tariff math (rule id `co2.nedc_to_wltp_factor`).

---

## Tariff formula (§ 2 Abs. 1 Z 3 — M1 person cars)

For each validity slice, tariff row stores:

| Field | Meaning |
|-------|---------|
| `co2_deduction_g` | Subtract from CO₂ before ÷ divisor |
| `rate_divisor` | Typically `5` |
| `max_rate_percent` | Cap on percentage rate |
| `malus_threshold_g` | CO₂ above this adds per-gram charge |
| `malus_eur_per_g` | EUR per g/km above threshold |
| `flat_deduction_eur` | Subtract after rate + malus (e.g. 350) |
| `min_rate_percent` | Wohnmobil SA only (16%) — separate class |

**Computation (primary law + BMF worked examples):**

1. `effectiveCo2` = after NEFZ factor if applicable.
2. `rawRate = (effectiveCo2 - co2_deduction_g) / rate_divisor`.
3. `ratePercent = roundToWholePercent(rawRate)` — NoVAG § 6: **auf volle Prozentsätze auf- bzw. abzurunden**; BMF describes **kaufmännisch gerundet** (engine uses **half-up** to integer percent; see UNVERIFIED).
4. `ratePercent = min(ratePercent, max_rate_percent)`; if `min_rate_percent` set, `ratePercent = max(ratePercent, min_rate_percent)`.
5. `baseAmount = netPriceEuro × ratePercent / 100`.
6. `malus = max(0, effectiveCo2 - malus_threshold_g) × malus_eur_per_g`.
7. `nova = max(0, baseAmount + malus - flat_deduction_eur)` — no tax credit (NoVAG § 6 Abs. 2).

**Negative rate before cap:** if `(effectiveCo2 - deduction) < 0`, raw rate is negative → rounded percent may be 0 or negative → **floor at 0%** before max cap.

---

## Versioned tariff table (representation)

Tariff versions are rows in code (v1) with:

```typescript
interface NovaTariffVersion {
  id: string;                    // e.g. "at-m1-2025-h1"
  vehicle_class: 'm1_z3' | 'n1_z3' | 'motorcycle_z1_z2';
  valid_from: string;            // ISO date, inclusive
  valid_to: string;              // ISO date, inclusive
  co2_deduction_g: number;
  rate_divisor: number;
  max_rate_percent: number;
  malus_threshold_g: number;
  malus_eur_per_g: number;
  flat_deduction_eur: number;
  min_rate_percent?: number;
  source_url: string;
  source_retrieved: string;
}
```

**Initial data** (M1 § 2 Z 3) — pin from BMF 2021–2025 page:

| id | valid_from | valid_to | deduction | max % | malus @ g/km | €/g | −€ |
|----|------------|----------|-----------|-------|--------------|-----|-----|
| `at-m1-2021-h2` | 2021-07-01 | 2021-12-31 | 112 | 50 | 200 | 50 | 350 |
| `at-m1-2022` | 2022-01-01 | 2022-12-31 | 107 | 60 | 185 | 60 | 350 |
| `at-m1-2023` | 2023-01-01 | 2023-12-31 | 102 | 70 | 170 | 70 | 350 |
| `at-m1-2024` | 2024-01-01 | 2024-12-31 | 97 | 80 | 155 | 80 | 350 |
| `at-m1-2025-h1` | 2025-01-01 | 2025-06-30 | 94 | 80 | 155 | 80 | 350 |
| `at-m1-2025-h2` | 2025-07-01 | 2025-12-31 | 94 | 80 | 155 | 80 | 350 |
| `at-m1-2026` | 2026-01-01 | 2026-12-31 | 91 | 80 | 155 | 80 | 350 |
| `at-m1-2027` | 2027-01-01 | 2027-12-31 | 88 | 80 | 155 | 80 | 350 |
| `at-m1-2028` | 2028-01-01 | 2028-12-31 | 85 | 80 | 155 | 80 | 350 |
| `at-m1-2029` | 2029-01-01 | 2029-12-31 | 82 | 80 | 155 | 80 | 350 |

N1 rows follow BMF N1 section (different deduction/malus thresholds). Motorcycle rows follow BMF WMTC section (÷4, 30% cap, 150 g malus at €20/g).

**Resolver:** `resolveTariffVersion(vehicleClass, referenceDate)` picks row where `valid_from ≤ referenceDate ≤ valid_to`.

---

## Exemptions

| Case | Treatment | Source |
|------|-----------|--------|
| **Pure BEV / H₂** (CO₂ 0 g/km, not hybrid) | **NoVA = 0**; exemption at delivery, not Vergütung | § 3 Abs. 1 Z 1; BMF/USP Befreiungen |
| **PHEV / HEV** | **Not exempt**; use weighted WLTP CO₂ | USP Befreiungen |
| § 3 Abs. 3 UStG-linked dealer demo | Out of v1 engine | § 3 Abs. 4 Z 3 |

**Engine:** `driveType: 'BEV' | 'FCEV'` → amount 0, rules `['exempt.z3.zero_co2']`; `co2GramsPerKm === 0` same.

---

## Transactions in scope (dealer product view)

| Flow | Taxable event | Typical debtor | NOVA form (info only) |
|------|---------------|----------------|------------------------|
| **New car sale** (domestic) | Lieferung | Dealer | NOVA 1 |
| **Used EU import** | Zulassung / § 1 Z 3 | Customer or dealer per § 4 | NOVA 2 (private) / NOVA 1 |
| **Used third country** | Zulassung or Lieferung | Per § 4 | NOVA 1 / 2 |
| **Trade-in / margin car** | If NoVA-relevant delivery or registration | Per § 4 | UNVERIFIED interaction with Differenzbesteuerung — Steuerberater |
| **IG Erwerb** | Acquisition day | Acquirer | NOVA 1 |

Cross-ref: `vehicle-stock-trading.md` (margin VAT) — NoVA is separate from USt margin scheme.

---

## NOVA 1 reporting deadline (Unternehmer)

| Rule | Text |
|------|------|
| Steuerschuld Lieferung | End of calendar month of delivery |
| Filing | **No later than the 15th day of the second month following** the month in which tax liability arose |
| Channel | NOVA 1 or FinanzOnline electronic |

Source: [BMF Erhebung der NoVA](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/erhebung-der-nova.html) (retrieved 2026-10-02). **Private Zulassung:** different rules (NOVA 2) — not expanded here.

---

## Engine contract

### Input (`CalculateNovaInput`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `co2GramsPerKm` | number | Conditional | Required unless BEV/FCEV exempt or `ratedPowerKw` fallback |
| `emissionCycle` | `WLTP` \| `NEDC` | Yes | NEDC triggers ×1.27 |
| `netPriceEuro` | number | Yes | Bemessungsgrundlage |
| `driveType` | `BEV` \| `FCEV` \| `PHEV` \| `ICE` \| `OTHER` | Yes | PHEV → warning if not weighted CO₂ |
| `firstRegistrationDate` | ISO date | Yes | For tariff resolution hints / warnings |
| `vehicleClass` | `m1_z3` \| `n1_z3` \| `motorcycle_z1_z2` | No (default `m1_z3`) | |

### Output (`CalculateNovaResult`)

| Field | Type | Notes |
|-------|------|-------|
| `novaAmountEuro` | number | 2 decimal places — see UNVERIFIED |
| `tariffVersionId` | string | Row used |
| `appliedRuleIds` | string[] | Traceability |
| `warnings` | string[] | e.g. `wertentwicklung_not_applied`, `phev_weighted_wltp` |
| `ratePercentApplied` | number | After cap |
| `effectiveCo2GramsPerKm` | number | After NEFZ conversion |

### Errors

| Code | When |
|------|------|
| `MISSING_CO2` | No CO₂, not exempt, no `ratedPowerKw` fallback |
| `UNKNOWN_TARIFF_VERSION` | Invalid `tariffVersion` id |
| `INVALID_NET_PRICE` | Negative or NaN |

---

## Database Impact

None for AUT-376. Future API may cache last calculation on vehicle sale — separate ticket.

---

## API Contract Changes

None for AUT-376.

---

## UX Compliance

N/A (no UI in this issue). Future vehicle UI: top-right actions, margin preview pattern per platform standards.

---

## Testing

| Layer | Requirement |
|-------|-------------|
| Unit | ≥30 cases: malus threshold ±1, deduction boundary, max rate cap, NEDC×1.27, round half-up percent, flat €350, zero floor, BEV exempt, missing CO₂ error |
| Golden | Optional cross-check against BMF official calculator — manual, not CI |

---

## Needs Steuerberater confirmation

Rules **not** pinned to a primary source in this spec (must not be invented in code):

| Topic | Question |
|-------|----------|
| **Final EUR rounding** | Cent rounding: always 2 decimals half-up, or FinanzOnline-specific step? |
| **Percent rounding tie-break** | § 6 “auf-/abzurunden” vs BMF “kaufmännisch” for exact .5 |
| **Extras on net price** | Which dealer extras belong in NoVA Entgelt vs separate |
| **Trade-in / margin scheme** | NoVA base when vehicle sold under Differenzbesteuerung |
| **N1 goods transport post Jul 2025** | Exclusion from NoVAG scope (BGBl. I 26/2025) — classification per vehicle |
| **Wertentwicklung** | Mandatory inputs (original list net, current net) for EU used in production |
| **Tageszulassung** | Interaction with exempt resale rules |

---

## Open Questions

1. Should the API layer default `tariffVersion` from `firstRegistrationDate` + transaction scope, or always require explicit version?
2. Store tariff table in DB for ops editing vs git-versioned TS (v1: **git-versioned TS**).

---

## References

- Linear: [AUT-376](https://linear.app/auto-core-platform/issue/AUT-376)
- Vehicle stock: `docs/internal/02-Feature-Specs/Vehicle/vehicle-stock-trading.md`
- ADR: none required (no persistence/API contract yet)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Issue | AUT-376 |
