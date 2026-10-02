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

> Austrian dealers must calculate, collect, and remit **Normverbrauchsabgabe (NoVA)** on taxable vehicle transactions. This spec defines a **pure, deterministic calculation engine** driven by a **versioned tariff table** (`valid_from` / `valid_to`) so annual BMF/RIS parameter changes are **data**, not application code. **Phase 1 (AUT-376):** internal spec + engine module only — no Prisma/schema, API route, UI, or invoice line changes.

**Consolidated law pinned:** [RIS NoVAG Gesamte Rechtsvorschrift](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004698) as retrieved **2026-10-02**, including amendments through **BGBl. I Nr. 62/2026** (Budgetbegleitgesetz 2027–2028; § 16 Abs. 29 amends § 6 Abs. 6 Z 2 and Abs. 8 — NEFZ×1,27 and Wertentwicklung), **BGBl. I Nr. 98/2025**, and **BGBl. I Nr. 26/2025** (repeal of § 6 Abs. 3 N1 tariff; § 2 scope). Re-check RIS before extending tariff rows beyond 2029.

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
| Unit tests | Table-driven; ≥30 boundary tests |

### Explicitly out of scope (follow-up tickets — do not implement here)

| Follow-up | Description |
|-----------|-------------|
| **API endpoint** | REST/OpenAPI `POST /vehicles/nova/calculate` |
| **Vehicle UI** | NoVA preview on vehicle stock / sale flows |
| **Invoice lines** | Snapshot NoVA on `InvoiceItem` |
| **NOVA 1 export** | FinanzOnline / NOVA 1 filing payload |

---

## Legal sources (primary)

| Source | Role | Retrieved |
|--------|------|-----------|
| [NoVAG konsolidiert (RIS)](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004698) | §§ 1–7, 12; § 6 Abs. 3 aufgehoben BGBl. I 26/2025 | 2026-10-02 |
| [NoVAG § 3 (RIS)](https://www.ris.bka.gv.at/eli/bgbl/1991/695/P3/NOR40273766) | Befreiungen | 2026-10-02 |
| [NoVAG § 5 (RIS)](https://www.ris.bka.gv.at/eli/bgbl/1991/695/P5/NOR40273768) | Bemessungsgrundlage | 2026-10-02 |
| [BMF NoVA Steuersatz](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz.html) | Event vs first registration; NEFZ×1,27; Wertentwicklung | 2026-10-02 |
| [BMF Rechtslage ab 1. Juli 2025](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_ab_1_juli_2025.html) | M1 / motorcycle Jul 2025–Dec 2029 | 2026-10-02 |
| [BMF Rechtslage 1. Juli 2021 – 30. Juni 2025](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_von_1_juli_2021_bis_30_juni_2025.html) | M1 / legacy N1 / motorcycle through H1 2025 | 2026-10-02 |
| [BMF Befreiungen](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-befreiung.html) | BEV/H₂ | 2026-10-02 |
| [BMF Erhebung](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/erhebung-der-nova.html) | NOVA 1 Frist | 2026-10-02 |
| [USP Befreiungen](https://www.usp.gv.at/themen/steuern-finanzen/weitere-steuern-und-abgaben/normverbrauchsabgabe-nova/Befreiungen.html) | BEV; hybrids not exempt | 2026-10-02 |

---

## Vehicle classes (tariff `vehicle_class`)

| `vehicle_class` | Legal basis | Notes |
|-----------------|-------------|-------|
| `passenger_z3` | § 2 Abs. 1 **Z 3** NoVAG | M1 and **personenbefördernde** Fahrzeuge mit 4–9 Sitzplätzen und ≤3 500 kg, **unabhängig von der kraftfahrrechtlichen Einordnung** (ab 1.7.2025). Uses **M1** BMF rows (÷5, €350 Abzug). |
| `n1_legacy_z6` | Former **§ 6 Abs. 3** (repealed 1.7.2025) | Separate N1 tariff only until **2025-06-30**. Last row: `at-n1-2025-h1`. |
| `motorcycle_z1_z2` | § 2 Abs. 1 Z 1–2; § 6 Abs. 1 | WMTC; ÷4; **no €350** Abzug (`flat_deduction_eur: 0`). |

**Out of scope (not in tariff table):** Kraftfahrzeuge **hauptsächlich zur Güterbeförderung** (§ 2 Abs. 1 Z 4 lit. a — Kastenwagen, Pritschenwagen, etc.) after BGBl. I 26/2025. **Engine v1** does not classify goods vs passenger vehicles; a future API may reject these with `OUT_OF_SCOPE_VEHICLE` before calling `calculateNova`.

---

## Which legal snapshot applies

| Transaction pattern | Tariff reference date | Primary source |
|--------------------|------------------------|----------------|
| **New domestic delivery** / **IG Erwerb** / **Drittland (Händler)** | **`taxableEventDate`** (Lieferung, IG-Erwerb, Zulassung) | BMF “Grundregelung”; NoVAG § 7 Abs. 1 |
| **EU/EWR used import** | Tariff at **first EU registration**; Malus + Abzug via **Wertentwicklung** | § 6 Abs. 8; BMF EU-Import |
| **Previously NoVA-befreit**, now taxable | Tariff at **first (befreite) domestic registration** | BMF “Befreite Kraftfahrzeuge” |
| **Dealer demo / Tageszulassung ≤3 months** | **Exempt** under § 3 Abs. 1 Z 2 while condition holds; if &gt;3 months → § 1 Z 3; **§ 6 Abs. 8 does not apply** | § 3 Abs. 1 Z 2; RIS |
| **Unwiderruflicher Kaufvertrag** (Übergang) | May use law until **31 Dec** of contract year | § 6 Abs. 7 |

**Engine v1:** Caller passes explicit `tariffVersion`. **`taxableEventDate`** drives `resolveTariffVersion()` when auto-resolving. **`firstRegistrationDate`** is optional; required only for warnings (`wertentwicklung_not_applied`, `eu_import_tariff_hint`). Wertentwicklung and Übergang are **not computed** in v1.

**Note on `at-m1-2025-h1` vs `at-m1-2025-h2`:** Numeric parameters are **identical** on the BMF pages; the split documents the **1 July 2025** change in **scope** (N1 legacy tariff ends; passenger N1 uses M1/`passenger_z3` rows; goods N1 out of scope), not a rate change.

---

## Tax base (Bemessungsgrundlage)

| Case | Base | Source |
|------|------|--------|
| Lieferung / IG Erwerb | **Entgelt** § 4 UStG 1994 (net of VAT) | § 5 Abs. 1 |
| Zulassung / Eigenverbrauch / Nutzungsänderung | **Gemeiner Wert** ohne USt; EU-Händler → Anschaffungspreis | § 5 Abs. 2 |
| NoVA on invoice | Not in VAT base | § 5 Abs. 3 |

**§ 6 Abs. 9:** If NoVA was included in the **Entgelt** of the **immediately following** umsatzsteuerpflichtigen sale, the buyer is entitled to **16,67%** of the NoVA as Vergütung (RIS § 6 Abs. 9). Relevant for **used-car resale and trade-in** alongside Differenzbesteuerung — **out of v1 engine**; listed under Steuerberater for process.

---

## CO₂ value and test cycle

| Rule | Detail | Source |
|------|--------|--------|
| `passenger_z3` | Kombinierter **WLTP**; PHEV → **gewichtet kombiniert** | § 6 Abs. 4 |
| `motorcycle_z1_z2` | **WMTC** g/km | § 6 Abs. 4 |
| NEFZ only | **×1,27** only for **§ 2 Abs. 1 Z 3** when exclusively NEFZ exists | § 6 Abs. 6 Z 2; BMF |
| No CO₂ (Z 3) | **2 × kW** Nennleistung, or NEFZ×1,27 path | § 6 Abs. 6 Z 2 |
| No CO₂ (motorcycle) | **(Hubraum − 100) × 0,02 %**, max 30% | § 6 Abs. 6 Z 1 |
| Wohnmobil SA | **16% Mindeststeuersatz** when CO₂ is taken from the optional **2×kW** basis (Z 4) **or** from any **§ 6 Abs. 6 Z 2** substitute (**2×kW** or **NEFZ×1,27**) | § 6 Abs. 6 Z 4 |

**Engine v1:**

- `emissionCycle: 'NEDC'` → ×1.27 only when `vehicleClass === 'passenger_z3'`; otherwise **`INVALID_NEDC_CYCLE`** for motorcycles.
- **`ratedPowerKw`** (Z 3): 2×kW substitute CO₂ for rate/malus.
- **`displacementCc`** (motorcycle): hubraum rate when CO₂ absent.
- **`isCamperSA`**: when true and effective CO₂ comes from **§ 6 Abs. 6 Z 2** (2×kW or NEDC×1.27) or the **Z 4** 2×kW option, apply **16%** minimum rate (rule id `tariff.camper_sa_min_rate`; not stored on tariff row). WLTP certificate CO₂ without Z 2 path does **not** trigger the minimum.

**Fractional CO₂ after ×1.27:** e.g. 130 × 1.27 = **165.1** g/km changes malus grams (10.1 × €80 vs 10 × €80). **UNVERIFIED** whether to round to whole grams before rate and malus — see *Needs Steuerberater confirmation*. Engine v1 uses **unrounded** effective CO₂ and emits warning `nedc_fractional_co2_unverified` when NEDC×1.27 is not an integer.

---

## Tariff formula (`passenger_z3` / legacy N1)

1. `effectiveCo2` — after NEFZ factor if applicable (see UNVERIFIED rounding).
2. `rawRate = (effectiveCo2 - co2_deduction_g) / rate_divisor`.
3. `ratePercent = roundToWholePercent(rawRate)`; floor at 0%; cap at `max_rate_percent`.
4. If `isCamperSA` && effective CO₂ came from **§ 6 Abs. 6 Z 2** (2×kW or NEDC×1.27) → `ratePercent = max(ratePercent, 16)` (§ 6 Abs. 6 Z 4).
5. `baseAmount = netPriceEuro × ratePercent / 100`.
6. `malus = max(0, effectiveCo2 - malus_threshold_g) × malus_eur_per_g`.
7. `nova = max(0, baseAmount + malus - flat_deduction_eur)`.

**Motorcycle:** same steps 2–6 with `rate_divisor: 4`, `flat_deduction_eur: 0`, or hubraum-only rate path per § 6 Abs. 6 Z 1.

---

## Versioned tariff table

```typescript
interface NovaTariffVersion {
  id: string;
  vehicle_class: 'passenger_z3' | 'n1_legacy_z6' | 'motorcycle_z1_z2';
  valid_from: string;
  valid_to: string;
  co2_deduction_g: number;
  rate_divisor: number;
  max_rate_percent: number;
  malus_threshold_g: number;
  malus_eur_per_g: number;
  flat_deduction_eur: number; // 350 for Z3/N1 legacy; 0 for motorcycles
  source_url: string;
  source_retrieved: string;
}
```

### `passenger_z3` (M1 BMF) — retrieved 2026-10-02

| id | valid_from | valid_to | ded. | max % | malus @ | €/g | −€ |
|----|------------|----------|------|-------|---------|-----|-----|
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

### `n1_legacy_z6` (§ 6 Abs. 3, last period 2025-06-30) — BMF 2021–2025 page

| id | valid_from | valid_to | ded. | max % | malus @ | €/g | −€ |
|----|------------|----------|------|-------|---------|-----|-----|
| `at-n1-2021-h2` | 2021-07-01 | 2021-12-31 | 165 | 50 | 253 | 50 | 350 |
| `at-n1-2022` | 2022-01-01 | 2022-12-31 | 160 | 60 | 238 | 60 | 350 |
| `at-n1-2023` | 2023-01-01 | 2023-12-31 | 155 | 70 | 223 | 70 | 350 |
| `at-n1-2024` | 2024-01-01 | 2024-12-31 | 150 | 80 | 208 | 80 | 350 |
| `at-n1-2025-h1` | 2025-01-01 | **2025-06-30** | 147 | 80 | 208 | 80 | 350 |

### `motorcycle_z1_z2` (§ 6 Abs. 1) — BMF pages

| id | valid_from | valid_to | ded. | max % | malus @ | €/g | −€ |
|----|------------|----------|------|-------|---------|-----|-----|
| `at-mc-2021-h2` | 2021-07-01 | 2023-12-31 | 55 | 30 | 150 | 20 | **0** |
| `at-mc-2024-h1` | 2024-01-01 | 2025-12-31 | 53 | 30 | 150 | 20 | **0** |
| `at-mc-2026-h1` | 2026-01-01 | 2027-12-31 | 51 | 30 | 150 | 20 | **0** |
| `at-mc-2028-h1` | 2028-01-01 | 2029-12-31 | 49 | 30 | 150 | 20 | **0** |

---

## Exemptions (§ 3 NoVAG)

| Provision | Case | Engine v1 |
|-----------|------|-----------|
| **§ 3 Abs. 1 Z 1** | Elektro / Wasserstoff, **0 g/km** (not hybrid) | **In** — `driveType` BEV/FCEV or CO₂ 0 |
| **§ 3 Abs. 1 Z 2** | Vorführfahrzeuge / **Tageszulassung** ≤3 months; tax after limit under § 1 Z 3 | **Out** — document only; no registration timer in v1 |
| **§ 3 Abs. 2 Z 1** | Export / IG-Lieferung; VIN + Sperre Genehmigungsdatenbank | **Out** |
| **§ 3 Abs. 2 Z 2** | Behinderung | **Out** |
| **§ 3 Abs. 2 Z 3** | Einsatzfahrzeuge (Rettung, etc.) | **Out** |
| **§ 3 Abs. 3** | Vergütung: Miete, Taxi, Fahrschule (&gt;80% Nutzung) | **Out** |
| **§ 3 Abs. 4 Z 3** | Diplomatic UStG § 6 Abs. 1 Z 6 lit. d analogue | **Out** (not dealer demo) |

PHEV/HEV: **not** exempt (USP/BMF).

---

## Transactions in scope (dealer)

| Flow | Taxable event | NOVA form (info) |
|------|---------------|------------------|
| New domestic sale | Lieferung | NOVA 1 |
| EU used import | Zulassung / § 1 Z 3 | NOVA 1 / 2 |
| Third country | Zulassung or Lieferung | NOVA 1 / 2 |
| Trade-in / used resale | Lieferung / Zulassung | NOVA 1; **§ 6 Abs. 9** Vergütung may apply |
| IG Erwerb | Erwerbstag | NOVA 1 |

---

## NOVA 1 deadline (Unternehmer)

Steuerschuld Lieferung: **Ende des Kalendermonats** der Lieferung (§ 7 Abs. 1 Z 1). Anmeldung **NOVA 1** spätestens **15. Tag des zweitfolgenden Monats** (BMF Erhebung, retrieved 2026-10-02).

---

## Engine contract

### Input (`CalculateNovaInput`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `taxableEventDate` | ISO date | Yes | Drives tariff resolution (delivery, IG, registration) |
| `firstRegistrationDate` | ISO date | No | EU import / § 6 Abs. 8 hints only |
| `co2GramsPerKm` | number | Conditional | Or substitute fields below |
| `emissionCycle` | `WLTP` \| `NEDC` | Yes | NEDC only for `passenger_z3` |
| `netPriceEuro` | number | Yes | Bemessungsgrundlage excl. VAT |
| `driveType` | enum | Yes | BEV/FCEV/PHEV/ICE/OTHER |
| `vehicleClass` | enum | No | Default `passenger_z3` |
| `ratedPowerKw` | number | No | § 6 Abs. 6 Z 2 (Z 3 only) |
| `displacementCc` | number | No | § 6 Abs. 6 Z 1 (motorcycle) |
| `isCamperSA` | boolean | No | 16% min when CO₂ from § 6 Abs. 6 Z 2 (2×kW or NEDC×1.27) per Z 4 |

### Errors

| Code | When |
|------|------|
| `MISSING_CO2` | No CO₂ and no valid substitute for class |
| `INVALID_CO2` | Non-finite or negative `co2GramsPerKm`, `ratedPowerKw`, or `displacementCc` |
| `INVALID_NEDC_CYCLE` | NEDC on motorcycle |
| `TARIFF_CLASS_MISMATCH` | `vehicleClass` does not match selected `tariffVersion` row |
| `UNKNOWN_TARIFF_VERSION` | Bad tariff id |
| `INVALID_NET_PRICE` | Invalid net price |

### Warnings (v1)

`phev_weighted_wltp`, `wertentwicklung_not_applied`, `nedc_fractional_co2_unverified`, `tariff_outside_registration_date`, `eu_import_tariff_hint` (when `firstRegistrationDate` set but Wertentwicklung not computed).

---

## Needs Steuerberater confirmation

| Topic | Question |
|-------|----------|
| **CO₂ rounding after NEDC×1.27** | Whole grams before rate/malus vs fractional (e.g. 165.1 g) |
| **Final EUR rounding** | Cent precision vs FinanzOnline |
| **Percent rounding** | § 6 auf-/abzurunden vs kaufmännisch at .5 |
| **Extras on Entgelt** | Factory/dealer extras in NoVA base |
| **Trade-in / margin VAT** | NoVA Bemessungsgrundlage with Differenzbesteuerung |
| **§ 6 Abs. 9 workflow** | 16,67% Vergütung on chained sale — operational steps |
| **Goods N1 classification** | Kastenwagen vs personenbefördernd per Einzelfall (§ 2 Z 4) |
| **Wertentwicklung inputs** | Original list net vs Achtelung in product |

**Removed from Steuerberater (now statute-pinned):** Tageszulassung mechanism (§ 3 Abs. 1 Z 2); post-Jul-2025 N1 scope (BGBl. I 26/2025).

---

## Testing

≥30 unit tests: boundaries, BEV, NEDC×1.27, motorcycle `flat_deduction_eur: 0`, legacy N1 last row end date.

---

## References

- [AUT-376](https://linear.app/auto-core-platform/issue/AUT-376)
- `vehicle-stock-trading.md`
