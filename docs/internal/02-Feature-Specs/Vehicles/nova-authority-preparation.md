---
title: "NoVA-2 draft and Genehmigungsdatenbank check (AUT-531)"
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

# NoVA-2 draft and Genehmigungsdatenbank check (AUT-531)

## Summary

> Staff at the pilot customer need a human-reviewed draft of the official NoVA 2 declaration and a record of what a person observed about the Genehmigungsdatenbank. Production has no NoVA-2 artifact and no approval-database check. This spec defines that draft and that check. It does not file a return, log into FinanzOnline, or treat a draft as accepted by the Finanzamt.

The machine contract is [`fixtures/nova-authority-preparation/form-contract.json`](fixtures/nova-authority-preparation/form-contract.json), [`fields.json`](fixtures/nova-authority-preparation/fields.json), and [`cases.json`](fixtures/nova-authority-preparation/cases.json). `fields.json` is the row for every official field. `cases.json` is synthetic. `numberOrigin` is `synthetic` and `independentValidation` is false. Party label is **pilot customer**.

Checked items in this spec bind the follow-up implementation. This pull request adds no page, no migration, and no product code.

---

## User Stories

- As an **accountant at the pilot customer**, I want a NoVA 2 draft filled from the vehicle, a confirmed EU-M1 calculation, and the site's LegalEntity so that missing identity or a conflicting CO₂ value stays visibly incomplete.
- As that **accountant**, I want to record UNKNOWN or CHECKED for the Genehmigungsdatenbank with a time and a note so that the screen never pretends an online lookup happened.
- As a **developer implementing the follow-up**, I want `cases.json` to reject a filing flag, a second open draft, and a v1 preview used as a confirmation.

---

## Current state (verified 2026-10-15)

Verified on `origin/main` at `7e3b2c90` (`AUT-530: NoVA EU-M1-2024 used import slice`). No product code changes in this issue.

| Behavior | Where | What the code does |
|----------|--------|--------------------|
| Calculation | `NovaCalculationService.calculate` | Returns a NoVA amount. It does not persist a confirmation, a form, or a check. |
| EU-M1 slice | `POST /api/vehicles/nova/calculate` | `importMode: eu_used_m1` can return `tariffSelectionBasis: first_eu_registration`, `intermediates`, and `novaAmountEuro`. A v1 call with no `importMode` still returns an amount plus scope warnings. |
| Vehicle | `Vehicle` | VIN, make, model, year, `fuel_type`, `power_kw`, `co2_wltp_g_km`, `co2_nedc_g_km`, `mileage`, `first_registration_date`, `site_id`. No Steuernummer, no SVNR, no birth date, no hubraum, no acquisition kilometre field. |
| Responsible party | `Site.legal_entity_id` | Immutable. `LegalEntity` holds name, postal address, phone, `tax_number`, `vat_id`, `country_iso` (`AT` or `DE`). |
| Invoice | `invoice-snapshot-v2.ts` | Snapshots `legal_entity_id` and a short vehicle block. It does not snapshot a NoVA declaration. |
| Sale | `vehicle-sale.service.ts` | Uses the site LegalEntity for the sale. It does not build NoVA 2. |
| Authority I/O | repository search | No NoVA-2 artifact and no Genehmigungsdatenbank client. |

`apps/core-api/test/vehicle-nova.e2e-spec.ts` covers the calculator. It is not evidence of a draft or a database check.

---

## Sources

Retrieved **2026-10-15**.

| Role | What was retrieved | Version observed | URL |
|------|--------------------|------------------|-----|
| Form catalog | NoVA 2 entry. The only variant on the page is the DOK online form. | Page retrieved 2026-10-15. The page has no Stand date. | [BMF form catalog, MIdVal 1126](https://service.bmf.gv.at/service/anwend/formulare/show_det.asp?MIdVal=1126&STyp=KAT&Typ=SD&s=Normverbrauchsabgabe) |
| Field contract | DOK form `fid=7888`, title `NoVA 2`, 77 data fields and the pinned option lists in `form-contract.json` | The DOK page has no Stand date. A `_no_cache` query on its script URLs changes between fetches and is not a form version. | [FormServlet fid 7888](https://afs-formulare.bmf.gv.at/IDOC/FormServlet?fid=7888) |
| Explanations | NoVA 2a PDF | Printed label `NoVA 2a, Seite 1, Version vom 01.07.2026`. PDF CreationDate `2026-06-26T12:50:28+02:00`. | [NOVA2a.pdf](https://formulare.bmf.gv.at/service/formulare/inter-Steuern/pdfd/9999/NOVA2a.pdf) |
| Procedure | Who files NoVA 2, who may enter the Genehmigungsdatenbank, how a person submits | Page `Letzte Aktualisierung: 1. Juli 2026` | [Erhebung der NoVA](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/erhebung-der-nova.html), [Verfahren](https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/fahrzeugimport/verfahren.html) |
| Used-import arithmetic already implemented | Slice `EU-M1-2024` | Spec date 2026-10-15, merged as AUT-530 | [nova-eu-used-import.md](nova-eu-used-import.md) |

NoVA 2a section 5 says a used vehicle brought directly from the rest of the community uses the domestic Rechtslage of the first registration in that area, and that Wertentwicklung is applied to the bonus/malus and the Abzug. The same PDF says the NoVA calculation uses the data the Generalimporteur or the Landesprüfstelle entered in the Genehmigungsdatenbank. The procedure page says a private person files NoVA 2 with Finanzamt Österreich, and an entrepreneur files NoVA 1 or FinanzOnline. A Generalimporteur who has been authorized as Parteienvertreter may calculate and release the vehicle. This contract does not call any of those systems.

---

## Scope

### In scope (this issue)

This issue delivers this spec and the three fixture files only.

### In scope for the follow-up implementation

One draft of NoVA 2 for a confirmed `eu_used_m1` calculation, plus an append-only human check of the Genehmigungsdatenbank.

| Bound | Value |
|-------|--------|
| Form contract | `nova2-dok-fid-7888-observed-2026-10-15` |
| Declaration box | `form_option_nova` true |
| Calculation | A persisted confirmation of an HTTP 200 `eu_used_m1` response with empty warnings, `hasUnverifiedRules: false`, `hasScopeLimitations: false`, and `tariffSelectionBasis: first_eu_registration` |
| Taxpayer on the form | Entered by a person. Not copied from Customer and not copied from LegalEntity. |
| Responsible LegalEntity | The active AT LegalEntity of `Vehicle.site_id` at draft creation |
| Check statuses | `UNKNOWN` when no row exists. `CHECKED` only with evidence, `observedAt`, and origin `human_observation` |
| Filing | Always false |

### Explicitly out of scope

| Item | Why it stays out |
|------|------------------|
| Submitting NoVA 2, NoVA 1, or a PDF to FinanzOnline | No filing action and no false confirmation |
| FinanzOnline login, session, or scraping | Not a documented integration we may call |
| DOK `FormServlet` or `JsonServlet` at runtime | The field list is pinned in `form-contract.json` |
| Genehmigungsdatenbank query, Sperre write, or Freischaltung | No public API was found. The check is a human note |
| A new agent approval wait or HUMAN_ONLY filing proposal | Existing proposal queue is not extended |
| Erwerbsteuer calculation | The box stays false unless a person checks it, and the export says the draft does not cover it |
| Vergütung and § 12b as a prepared product path | Sections stay inactive until a person opens them. Empty opened sections are incomplete |
| Invoice lines, sale totals, `FinanceSettings.lock_date` | The draft is not a fiscal posting |
| Changing AUT-530 arithmetic | The confirmation re-runs the existing service and stores that result |

---

## Decisions

1. **Manual draft versus authority access.** Export and the CHECKED note are local records. The procedure page's real prerequisites (FinanzOnline user, ID Austria for a video appointment, EPS payment, Parteienvertreter authorization, Generalimporteur or Landesprüfstelle for the database entry) are documented below and are not credentials, clients, or steps in this contract. Fixture work and draft creation need no tax advisor.
2. **No invented API.** `recordedStateOrigin` accepts only `human_observation`. `finanzonline_api` and any other origin return HTTP 400 `ORIGIN_NOT_ALLOWED`.
3. **Block and release are observations.** `recordedDatabaseState` is `BLOCK`, `RELEASE`, `NOT_ENTERED`, or `OTHER`. The system status is still `CHECKED`. The UI must not present that state as an authority response. `observedAt` is the time the person says they saw it. `recordedAt` is the server time. Both are stored. A Sperre checkbox on the form is a request the person might later file. Mapping never sets `form_check_verminderung` or `form_verguetung_o123` from a check row.
4. **Incomplete stays incomplete.** `completeness` is `INCOMPLETE` or `READY_FOR_REVIEW`. There is no `FILED`, `SUBMITTED`, or `ACCEPTED`. A review of an incomplete draft returns HTTP 422 `DRAFT_INCOMPLETE`.
5. **Review is not filing.** `reviewState` moves from `UNREVIEWED` to `REVIEWED` only when the client sends `filingAuthorized: false`. `true` returns HTTP 400 `FILING_NOT_AUTHORIZED`.
6. **LegalEntity is the responsible organization, not the taxpayer.** `form_vertretung` may be suggested from the LegalEntity name, street, zip, city, and phone. `tax_number` and `vat_id` are never copied. The draft adds warning `legal_entity_tax_number_not_used` when either value is present. A warning does not by itself make the draft incomplete.
7. **Wertentwicklung is written as scaled components.** The DOK form has no factor field. NoVA 2a says the aliquot share is entered on the malus and the Abzug. `valueDevelopmentFactor.numerator` and `denominator` are the unreduced confirmation factor from AUT-530. For `known_new_net` they are the euro amounts (`20000/20000` on the same-day fixtures, `20000/40000` on the cross-year fixture), not a reduced ratio such as `1/1` or `1/2`. `form_co2malus` and `form_abzugsposten` receive `roundMoneyEuro(gross * numerator / denominator)` using the existing `roundMoneyEuro` (`Math.round(amount * 100) / 100`). The base and the percent are not scaled. If `scaledMalus - scaledDeduction` is not equal to `fixedAfterDevelopmentEuro`, both fields are null and the draft is incomplete with `COMPONENT_MISMATCH`. `confirmedNovaAmountEuro` is metadata. It is not a form field. The official NoVA tab has no total box. The form amounts stay 2650 (malus 400, Abzug 350) and 2625 (malus 200, Abzug 175).
8. **Rechtslage follows the confirmed tariff date.** `form_rechtslage` is the pinned option label whose inclusive range contains `tariffSelectionDate`. For `2024-06-01` that label is `01.01.2024 - 31.12.2024`. Zero matches: `RECHTSLAGE_UNMATCHED`. Two matches: `AMBIGUOUS_RECHTSLAGE`. The pinned list is not a calculator. Counter 10 and counter 11 overlap in 2011; counter 15 is stored as observed (`01.01.2016 - 31.12.2019`).
9. **Document site is the vehicle site.** The session site switcher is ignored. `cases.json` `ready-factor-one` sends a different `sessionSiteId` and still stores `Vehicle.site_id`. The caller needs an active membership on that vehicle site. Tenant comes from the authenticated context.
10. **No ADR.** The follow-up adds a draft, a confirmation snapshot, and an append-only note. It does not add an authority integration and it does not change the calculator. An ADR is required only if a later change adds that integration.

---

## Field mapping

`fields.json` has one row per official data field, in form order. The SHA-256 of the newline-joined names is `21e8e6303bb3694e2ae57dd7d2c3343b0ff9a93aca232ad90a39c865187d839d`. The follow-up refuses a contract whose field-name hash differs (`FORM_CONTRACT_MISMATCH`) instead of guessing a renamed box.

Requiredness:

| Value | Rule |
|-------|------|
| `review` | Null or failed validation adds the row's missing code and `completeness` is `INCOMPLETE` |
| `identity` | Group rule below. Failure adds `IDENTITY_MISSING`, `IDENTITY_PARTIAL`, or `IDENTITY_FORMAT` |
| `optional` | Null stays reviewable |
| `review_when_scaled` | Filled from the confirmation. A rounding mismatch adds `COMPONENT_MISMATCH` |
| `constant_true` / `constant_false` | Mapper value. Not editable, except where the inactive-section rule says a person may open a section |
| `inactive` | Ignored while its section is off. When the section is on, the row's missing code applies |

Identity group, which is stricter than the DOK script: the script clears the HTML required flag when any of the three fields has length greater than zero. This contract does not.

- Valid Steuernummer `^\d{2} \d{3}/\d{4}$` satisfies the group.
- Otherwise a valid Versicherungsnummer `^\d{4}-\d{6}$` and a real ISO `form_geburtsdatum` together satisfy it.
- A non-empty value that fails its pattern is `IDENTITY_FORMAT`.
- One of SVNR or birth date without the other, and without a valid Steuernummer, is `IDENTITY_PARTIAL`.
- All empty is `IDENTITY_MISSING`.

`form_antrieb` uses `form-contract.json` `fuelToAntrieb` on the uppercased `Vehicle.fuel_type`. `BENZIN`, `PETROL`, and `GASOLINE` map to `Benzin`. `DIESEL` maps to `Diesel`. Empty fuel is `ANTRIEB_MISSING`. Any other fuel, including hybrid, is `ANTRIEB_AMBIGUOUS` and the value stays null. Fuel that denotes an electric or hydrogen vehicle while the confirmation `driveType` is `ICE` is `DRIVE_CONFLICT`.

`form_artkraftfahrzeug` is `PKW` for `passenger_z3` only.

`Vehicle.mileage` is never `form_fahrzeug_kmstand_erwerb`. A non-null mileage adds warning `mileage_not_acquisition_km`. `co2_nedc_g_km` is never `form_co2_NEFZ`. A non-null NEDC value adds warning `nedc_present_not_copied`. `stock_received_at` is not the acquisition date.

A non-null `Vehicle.co2_wltp_g_km` that differs from `effectiveCo2GramsPerKm` unsets `form_co2_WLTP` and adds `CO2_SNAPSHOT_MISMATCH` plus `CO2_MISSING`.

Editable fields are those with source `human_entry`, plus `form_vertretung`, `form_option_vergf`, `form_option_fahrzeugeinzelbesteuerung`, and `form_ant1`. A patch of any other field returns HTTP 400 `FIELD_NOT_EDITABLE`. Opening the refund section without its required boxes yields `refund-section-incomplete`. Opening temporary use or Erwerbsteuer makes the codes in `fields.json` apply. Refund options a–d are exclusive. Temporary-use kind boxes are exclusive. Payout boxes X1 and X2 are exclusive. Two boxes in an exclusive group add `EXCLUSIVE_GROUP`.

`form_vertretung` suggestion, when every part exists: `{name}, {street}, {zip} {city}, {phone}`. The person may clear it. Clearing stays reviewable.

The 77 rows below match `fields.json`. If they diverge, `fields.json` is the file the tests load and this table must be updated in the same change.

| Field | Requiredness | Source | Missing or conflict |
|---|---|---|---|
| `rec_ob_id_1_1` | `optional` | `none` | leave_blank. Do not call JsonServlet. The control is disabled on the official form. |
| `rec_ob_val_1_1` | `optional` | `human_entry` | leave_blank. No Finanzamt master data. |
| `rec_ob_name_1_1` | `optional` | `human_entry` | leave_blank. No Finanzamt master data. |
| `rec_ob_id_2_1` | `optional` | `none` | leave_blank. Disabled dynlist. Do not call JsonServlet. |
| `rec_ob_val_2_1` | `optional` | `human_entry` | leave_blank. No Finanzamt master data. |
| `rec_ob_name_2_1` | `optional` | `human_entry` | leave_blank. No Finanzamt master data. |
| `rec_addrlist_1` | `optional` | `none` | leave_blank. Official address book is not queried. |
| `rec_name_1` | `optional` | `human_entry` | leave_blank. Missing recipient stays reviewable. Export says the recipient was not filled. |
| `rec_street_1` | `optional` | `human_entry` | leave_blank. Same as rec_name_1. |
| `rec_plz_1` | `optional` | `human_entry` | leave_blank. Same as rec_name_1. |
| `rec_place_1` | `optional` | `human_entry` | leave_blank. Same as rec_name_1. |
| `form_steuernummer` | `identity` | `human_entry` | identity_rule. LegalEntity.tax_number and vat_id are never copied. Invalid pattern is IDENTITY_FORMAT. |
| `form_versicherungsnummer` | `identity` | `human_entry` | identity_rule. A non-empty value without a birth date does not satisfy the group. |
| `form_geburtsdatum` | `identity` | `human_entry` | identity_rule. Stored as ISO date. Not taken from Customer. |
| `form_abgabepflichtiger_name` | `review` | `human_entry` | TAXPAYER_NAME_MISSING. Not taken from LegalEntity.name. |
| `form_abgabepflichtiger_zustell_name` | `optional` | `human_entry` | leave_blank. None. |
| `form_abgabepflichtiger_adresse` | `review` | `human_entry` | TAXPAYER_ADDRESS_MISSING. Not taken from LegalEntity.address_street. |
| `form_abgabepflichtiger_plz` | `review` | `human_entry` | TAXPAYER_POSTCODE_MISSING. Not taken from LegalEntity.address_zip. |
| `form_abgabepflichtiger_ort` | `review` | `human_entry` | TAXPAYER_CITY_MISSING. Not taken from LegalEntity.address_city. |
| `form_abgabepflichtiger_telefon` | `optional` | `human_entry` | leave_blank. LegalEntity.phone is not copied here. |
| `form_vertretung` | `optional` | `legal_entity_suggestion` | leave_blank. Suggestion only. Clearing it stays reviewable. It is not a tax-advisor mandate. |
| `form_antrieb` | `review` | `vehicle_fuel_type` | ANTRIEB_MISSING. Ambiguous or hybrid fuel is ANTRIEB_AMBIGUOUS and the value stays null. ICE confirmation plus electric fuel is DRIVE_CONFLICT. |
| `form_fahrzeug_typ` | `optional` | `vehicle_make_model` | leave_blank. Joined make and model only. No brand catalog lookup. |
| `form_fahrzeug_nummer` | `review` | `vehicle_vin` | VIN_MISSING. Confirmation has no VIN. A blank VIN is not replaced with a sample. |
| `form_fahrzeug_erwerb` | `optional` | `human_entry` | leave_blank. Vehicle has no acquisition-date column. Do not use stock_received_at. |
| `form_fahrzeug_eu_zulassung` | `review` | `confirmation_first_registration` | FIRST_REGISTRATION_MISSING. ISO date in the contract. This is the first EU registration, not an Austrian registration. |
| `form_fahrzeug_baujahr` | `optional` | `vehicle_year` | leave_blank. Copied only when Vehicle.year is an integer. |
| `form_fahrzeug_kmstand_erwerb` | `optional` | `human_entry` | leave_blank. Vehicle.mileage is not this field. Warning mileage_not_acquisition_km when mileage is set. |
| `form_ccm` | `optional` | `human_entry` | leave_blank. No hubraum column. Not derived from the calculator. |
| `form_co2_WMTC` | `optional` | `none` | leave_blank. Motorcycle cycle. Not filled for passenger_z3. |
| `form_co2_WLTP` | `review` | `confirmation_effective_co2` | CO2_MISSING. Unset when vehicle.co2_wltp_g_km is non-null and differs. Code CO2_SNAPSHOT_MISMATCH. |
| `form_co2_NEFZ` | `optional` | `none` | leave_blank. Vehicle.co2_nedc_g_km is not copied. Warning nedc_present_not_copied. |
| `form_fahrzeug_leistung` | `optional` | `vehicle_power_kw` | leave_blank. Copied when power_kw is a non-negative integer. |
| `form_fahrzeug_noX_emission` | `optional` | `human_entry` | leave_blank. No NOx column. |
| `form_fahrzeug_diesel_gkm` | `optional` | `human_entry` | leave_blank. No particle column. Disabled by the official form for Benzin. |
| `form_cons_liter` | `optional` | `human_entry` | leave_blank. Not a calculator input. |
| `from_verwendungszweck` | `optional` | `human_entry` | leave_blank. Official name is from_verwendungszweck. |
| `form_option_nova` | `constant_true` | `constant` | not_applicable. This contract always checks this box. |
| `form_option_vergf` | `inactive` | `constant_false` | not_applicable. Human may set true. The refund section then becomes required and an empty section is INCOMPLETE. |
| `form_option_fahrzeugeinzelbesteuerung` | `inactive` | `constant_false` | not_applicable. Human may set true. Erwerbsteuer is then required. This contract does not calculate it. |
| `form_datum` | `review` | `draft_created_vienna_date` | not_applicable. Pinned at creation. Not refreshed on read. |
| `form_rechtslage` | `review` | `tariff_selection_date` | Zero matches: value null and RECHTSLAGE_UNMATCHED. Two matches: value null and AMBIGUOUS_RECHTSLAGE. |
| `form_artkraftfahrzeug` | `review` | `confirmation_vehicle_class` | ART_UNSUPPORTED. passenger_z3 maps to value PKW. Any other class is ART_UNSUPPORTED and null. |
| `form_bemessungsgrundlage` | `review` | `confirmation_net_price` | BASIS_MISSING. Below 0.01 is BASIS_BELOW_FORM_MINIMUM and null. |
| `form_steuersatz` | `review` | `confirmation_rate_percent` | RATE_MISSING. Integer from ratePercentApplied. A non-integer is RATE_NOT_INTEGER and null. |
| `form_co2malus` | `review_when_scaled` | `confirmation_scaled_malus` | COMPONENT_MISMATCH. roundMoneyEuro(malusGrossEuro * unreduced numerator / denominator). Unset when the cent difference does not equal fixedAfterDevelopmentEuro. |
| `form_co2bonus` | `optional` | `none` | leave_blank. Not used for the 2024 PKW row. Left null. |
| `form_co2bonus_special` | `optional` | `none` | leave_blank. Left null. |
| `form_co2malus_special` | `optional` | `none` | leave_blank. Left null. |
| `form_abzugsposten` | `review_when_scaled` | `confirmation_scaled_deduction` | COMPONENT_MISMATCH. roundMoneyEuro(deductionGrossEuro * unreduced numerator / denominator), positive euros. Same mismatch rule as form_co2malus. |
| `form_abh` | `optional` | `none` | leave_blank. Not produced by EU-M1-2024. |
| `form_wahlrecht` | `constant_false` | `constant` | not_applicable. Wohnmobil only. passenger_z3 keeps it false. |
| `form_ant1` | `inactive` | `constant_false` | not_applicable. Human may set true. Temporary-use fields then become required. |
| `ant1_datum` | `inactive` | `human_entry` | TEMPORARY_USE_INCOMPLETE. Required only when form_ant1 is true. |
| `ant2_datum` | `inactive` | `human_entry` | TEMPORARY_USE_INCOMPLETE. Required only when form_ant1 is true. |
| `form_ant_cb1_1` | `inactive` | `human_entry` | TEMPORARY_USE_KIND_REQUIRED. Exactly one of the three kind boxes when form_ant1 is true. |
| `form_ant_cb1_2` | `inactive` | `human_entry` | TEMPORARY_USE_KIND_REQUIRED. Same exclusive group. |
| `form_ant_cb1_3` | `inactive` | `human_entry` | TEMPORARY_USE_KIND_REQUIRED. Same exclusive group. |
| `form_check_verminderung` | `inactive` | `human_entry` | TEMPORARY_USE_INCOMPLETE. A filing request. Required only when form_ant1 and Erstanmeldung are true. Never set from a CHECKED observation. |
| `form_check_inland` | `inactive` | `human_entry` | TEMPORARY_USE_INCOMPLETE. Same visibility as form_check_verminderung. |
| `form_ant_betrag1` | `inactive` | `human_entry` | TEMPORARY_USE_INCOMPLETE. Required only when form_ant1 is true. Not the confirmed novaAmountEuro. |
| `form_verguetung_optiona` | `inactive` | `human_entry` | REFUND_OPTION_REQUIRED. Exclusive with the other three refund options. |
| `form_verguetung_optionb` | `inactive` | `human_entry` | REFUND_OPTION_REQUIRED. Exclusive. |
| `form_verguetung_optionc` | `inactive` | `human_entry` | REFUND_OPTION_REQUIRED. Exclusive. When true, ver1_datum, ver2_datum and form_hoeheverguetung are required. |
| `form_verguetung_optiond` | `inactive` | `human_entry` | REFUND_OPTION_REQUIRED. Exclusive. |
| `ver1_datum` | `inactive` | `human_entry` | REFUND_12B_INCOMPLETE. Required only for option c. |
| `ver2_datum` | `inactive` | `human_entry` | REFUND_12B_INCOMPLETE. Required only for option c. |
| `form_verguetung_o123` | `inactive` | `human_entry` | REFUND_BLOCK_REQUEST_MISSING. Shown for options a–c. A request checkbox, not a database status. |
| `form_verguetung_grund` | `inactive` | `human_entry` | REFUND_REASON_MISSING. Required when the refund section is active. |
| `form_hoeheverguetung` | `inactive` | `human_entry` | REFUND_12B_INCOMPLETE. Required when option c is selected. The official script sets required only then. |
| `form_verguetung_optionX1` | `inactive` | `human_entry` | REFUND_PAYOUT_REQUIRED. Exactly one of X1 or X2 when the refund section is active. |
| `form_verguetung_optionX2` | `inactive` | `human_entry` | REFUND_PAYOUT_REQUIRED. Same exclusive pair. |
| `form_verguetung_konto` | `inactive` | `human_entry` | REFUND_ACCOUNT_MISSING. Required when X2 is selected. |
| `form_einzel_bemessungsgrundlage` | `inactive` | `human_entry` | ACQUISITION_VAT_BASIS_MISSING. Required only when the Erwerbsteuer box is checked. Not invoice total_net. |
| `form_option_JungholzOrMittelberg` | `optional` | `human_entry` | leave_blank. Default false. Not inferred from an address. |
| `form_fahrzeuglieferant` | `optional` | `human_entry` | leave_blank. Not taken from Vendor. |
| `form_mitgliedstaat` | `optional` | `human_entry` | leave_blank. Not inferred. The official sample value GERMANY is not a default. |


---

## Check status

| Situation | `status` | Evidence | Timestamp |
|-----------|----------|----------|-----------|
| No `NovaApprovalCheck` row for the vehicle | `UNKNOWN` | null | `observedAt` and `recordedAt` null |
| Person posts a valid check | `CHECKED` | `evidenceNote` length 1–500 | `observedAt` from the body. `recordedAt` set by the server |

`UNKNOWN` cannot be posted. A missing note, a missing `observedAt`, or an `observedAt` more than five minutes after server time returns HTTP 400. The GET returns the latest row and the history. A new CHECKED row does not delete the older one and does not change draft `completeness` or `reviewState`. The check stores `vin` as observed at record time. It does not read the Genehmigungsdatenbank.

There is no status that means "released online" or "blocked online".

---

## Tenant, site, and LegalEntity

1. Load the vehicle in the authenticated tenant. Another tenant's id is HTTP 404.
2. `Vehicle.site_id` null → HTTP 422 `VEHICLE_SITE_REQUIRED`.
3. The caller needs an active membership on that site. Otherwise HTTP 403.
4. The site must be active and its LegalEntity must be active and `country_iso = AT`. Otherwise HTTP 422 `LEGAL_ENTITY_UNUSABLE`.
5. Store `site_id` and `legal_entity_id` on the draft. Later switcher changes do not move the document.
6. Load vehicle, site, and LegalEntity once per request. Do not query them inside a loop over the 77 fields.

---

## Repeat and correction

- At most one `OPEN` draft per tenant and vehicle. A second create returns HTTP 409 `DRAFT_ALREADY_OPEN` and the existing id.
- `POST .../supersede` with a non-empty `reason` creates a new `OPEN` draft, copies human fields, re-runs the mapper on the current vehicle and the chosen confirmation, and sets the previous draft to `SUPERSEDED`. The new review state is `UNREVIEWED`. The check history is unchanged.
- A `REVIEWED` or `SUPERSEDED` draft rejects patches with HTTP 409 `DRAFT_IMMUTABLE`.
- Export may be repeated. Each export appends a log row. Export does not create a draft and does not set `CHECKED`.
- A confirmation is immutable. A later vehicle edit does not rewrite it. The draft mapper compares the live vehicle with the snapshot and surfaces conflicts.

Rule version on the confirmation is `tariffVersionId` plus `appliedRuleIds` from the re-run response, together with `form_contract_id`. A draft whose confirmation `form_contract_id` differs from the pinned contract returns HTTP 422 `FORM_CONTRACT_MISMATCH`.

---

## Confirmation

`POST` confirmation re-runs `NovaCalculationService.calculate` with the stored request and `vehicleId`. The client does not supply the euro amount as the source of truth. The server stores the request and the response only when the fresh result matches the client's echoed response field-for-field on the amount, tariff, `appliedRuleIds`, intermediates (`rateRaw`, `fullYearsElapsed`, the unreduced `valueDevelopmentFactor`, and the money fields), and warning flags. A reduced factor such as `1/1` is `CONFIRMATION_STALE`. A mismatch is HTTP 422 `CONFIRMATION_STALE`.

A v1 response, a response with warnings, `hasScopeLimitations: true`, or any mode other than a successful `eu_used_m1` is HTTP 422 `UNCONFIRMED_PREVIEW`. No row is written. `v1-preview-refused` locks that.

---

## Database Impact

These tables are for the follow-up. This spec PR does not migrate.

### New Tables / Columns

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
| `nova_calculation_confirmations` | `id` | uuid | no | Primary key |
| | `tenant_id`, `site_id`, `legal_entity_id`, `vehicle_id` | uuid | no | Copied from the vehicle site at confirm time |
| | `created_by_user_id` | uuid | no | Authenticated user |
| | `created_at` | timestamptz | no | Server time |
| | `request_json`, `response_json` | jsonb | no | The re-run pair |
| | `tariff_version_id` | text | no | From the response |
| | `nova_amount_euro` | decimal(12,2) | no | From the response |
| | `form_contract_id` | text | no | Pinned contract id |
| `nova_authority_drafts` | `id` | uuid | no | |
| | `tenant_id`, `site_id`, `legal_entity_id`, `vehicle_id`, `confirmation_id` | uuid | no | `confirmation_id` `ON DELETE RESTRICT` |
| | `status` | text | no | `OPEN` or `SUPERSEDED` |
| | `completeness` | text | no | `INCOMPLETE` or `READY_FOR_REVIEW` |
| | `review_state` | text | no | `UNREVIEWED` or `REVIEWED` |
| | `incompleteness_codes`, `conflict_codes`, `warnings` | text[] | no | Empty array when none |
| | `field_values` | jsonb | no | Map of the 77 names to `{ value, source }` |
| | `form_contract_id` | text | no | |
| | `supersedes_draft_id` | uuid | yes | |
| | `supersede_reason` | text | yes | Required on the new row when it supersedes |
| | `reviewed_at`, `reviewed_by_user_id` | timestamptz / uuid | yes | Set together on review |
| | `filing_authorized` | boolean | no | Check constraint `= false` |
| | `created_at`, `updated_at`, `created_by_user_id` | | no | |
| `nova_approval_checks` | `id`, `tenant_id`, `vehicle_id` | uuid | no | |
| | `vin_snapshot` | text | no | |
| | `status` | text | no | Only `CHECKED` is stored |
| | `recorded_database_state` | text | no | `BLOCK`, `RELEASE`, `NOT_ENTERED`, `OTHER` |
| | `recorded_state_origin` | text | no | Only `human_observation` |
| | `observed_at`, `recorded_at` | timestamptz | no | |
| | `evidence_note` | text | no | 1–500 characters |
| | `created_by_user_id` | uuid | no | |
| `nova_authority_exports` | `id`, `draft_id`, `exported_by_user_id`, `exported_at` | | no | |
| | `payload_sha256` | text | no | |
| | `filing_claimed` | boolean | no | Check constraint `= false` |

Partial unique index: one `OPEN` draft per `(tenant_id, vehicle_id)`.

No column is added to `Vehicle`, `Invoice`, `VehicleSale`, or `LegalEntity`.

### Modified Tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
| None in this PR | Follow-up adds only the four tables above | Yes, in the follow-up PR |

### Deletion Policy Impact

This PR does not edit `docs/deletion-policy.md`. The follow-up PR adds these rows and regenerates the tenant-restore SQL.

| Entity | Rule |
|--------|------|
| `NovaAuthorityDraft` | Hard delete only while `OPEN`, `UNREVIEWED`, and with no export row. `REVIEWED` and `SUPERSEDED` drafts are kept. No soft-delete flag. |
| `NovaCalculationConfirmation` | No delete while any draft references it. |
| `NovaApprovalCheck` | No delete and no update. Append only. |
| `NovaAuthorityExport` | No delete. Kept with the draft. |
| `Vehicle` | Existing blocks remain. Also block while an `OPEN` draft or a confirmation exists. |
| `LegalEntity` | Existing blocks remain. Also block while a draft or a confirmation references it. |

Deleting a draft does not delete its check rows. Checks are vehicle history, not draft attachments.

### State machines, inventory, fiscal lock, realtime

Draft `status`: `OPEN` → `SUPERSEDED` only, inside a transaction that inserts the successor first. `updateMany` where `status = OPEN`. Zero rows means HTTP 409.

`review_state`: `UNREVIEWED` → `REVIEWED` only when `status = OPEN` and `completeness = READY_FOR_REVIEW`, with the same `updateMany` guard.

`completeness` is recomputed by the mapper. The client does not send it.

No `InventoryTransaction`. No invoice and no tax posting, so `FinanceSettings.lock_date` does not apply. Do not add these entities to `SUPPORTED_ENTITY_TYPES` or `dashboard-entity-map.ts`.

---

## API Contract Changes

Implemented in the follow-up, not in this spec PR. Global prefix `api`. Tenant session, same as the vehicle routes. JSON only. No PDF and no multipart upload.

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| POST | `/api/vehicles/:vehicleId/nova-authority/confirmations` | Calculate request echo plus response echo | `{ id, novaAmountEuro, tariffVersionId, formContractId }` | Tenant, membership on the vehicle site |
| POST | `/api/vehicles/:vehicleId/nova-authority/drafts` | `{ confirmationId, humanFields }` | Draft, including `completeness`, codes, `fieldValues`, `check.status` | Same |
| GET | `/api/vehicles/:vehicleId/nova-authority/drafts/:draftId` | | Draft | Same |
| PATCH | `/api/vehicles/:vehicleId/nova-authority/drafts/:draftId` | `{ humanFields }` subset | Recomputed draft | Same. Calculated keys → 400 |
| POST | `/api/vehicles/:vehicleId/nova-authority/drafts/:draftId/review` | `{ filingAuthorized: false }` | `reviewState: REVIEWED` | Same |
| POST | `/api/vehicles/:vehicleId/nova-authority/drafts/:draftId/supersede` | `{ reason, confirmationId }` | New draft and previous id | Same |
| POST | `/api/vehicles/:vehicleId/nova-authority/drafts/:draftId/export` | empty | Export envelope below | Same |
| GET | `/api/vehicles/:vehicleId/nova-authority/check` | | `UNKNOWN` or latest `CHECKED` plus `history` | Same |
| POST | `/api/vehicles/:vehicleId/nova-authority/checks` | Check body in `cases.json` | Stored `CHECKED` row | Same |

Export envelope:

```json
{
  "filing": false,
  "submittedToAuthority": false,
  "authorityLookupPerformed": false,
  "covers": ["nova_declaration"],
  "doesNotCover": [
    "erwerbsteuer",
    "verguetung",
    "genehmigungsdatenbank_write",
    "finanzonline_submission"
  ],
  "completeness": "READY_FOR_REVIEW",
  "reviewState": "UNREVIEWED",
  "check": { "status": "UNKNOWN", "observedAt": null, "evidence": null },
  "confirmedNovaAmountEuro": 2650,
  "fields": {}
}
```

`fields` is the 77-name map. `confirmedNovaAmountEuro` sits beside it because the official form has no total field. A `READY_FOR_REVIEW` export is still not a filing. An `INCOMPLETE` export includes `incompletenessCodes` and is the visible incomplete case.

### Modified Endpoints

| Method | Route | Change Description |
|--------|-------|--------------------|
| None | | `POST /api/vehicles/nova/calculate` stays read-only. Invoice snapshot v2 does not gain NoVA fields. |

### Error catalog

| HTTP | Code | When |
|------|------|------|
| 400 | `ORIGIN_NOT_ALLOWED` | Check origin is not `human_observation` |
| 400 | `STATUS_NOT_RECORDABLE` | Body status is not `CHECKED` |
| 400 | `EVIDENCE_REQUIRED` | Blank note or missing `observedAt` |
| 400 | `FIELD_NOT_EDITABLE` | Patch includes a calculated field |
| 400 | `FILING_NOT_AUTHORIZED` | Review body says filing is authorized |
| 403 | | No active membership on the vehicle site |
| 404 | | Vehicle or draft not in the tenant |
| 409 | `DRAFT_ALREADY_OPEN` | Second open draft |
| 409 | `DRAFT_IMMUTABLE` | Patch after review or supersede |
| 422 | `UNCONFIRMED_PREVIEW` | v1 or warned calculation |
| 422 | `CONFIRMATION_STALE` | Re-run differs from the echo |
| 422 | `VEHICLE_SITE_REQUIRED` | No `site_id` |
| 422 | `LEGAL_ENTITY_UNUSABLE` | Inactive site or entity, or country not `AT` |
| 422 | `DRAFT_INCOMPLETE` | Review before the draft is ready |
| 422 | `FORM_CONTRACT_MISMATCH` | Field-name hash or contract id differs |

### OpenAPI Regeneration

The follow-up runs both commands and commits both artifacts. This spec PR changes no DTO, so it does not run them.

- `npm --prefix apps/core-api run openapi:generate`
- `npm --prefix apps/core-web run api:types:generate`

---

## Authority access that this contract does not use

Kept separate so a fixture or a draft is not mistaken for a live filing path. Retrieved 2026-10-15 from the procedure and assessment pages dated 1 July 2026.

| System | Who may use it, as published | What this product does |
|--------|------------------------------|------------------------|
| Genehmigungsdatenbank entry | Generalimporteur or Landesprüfstelle. No public write API is documented on those pages. | Nothing. No credentials. |
| Freischaltung | Finanzamt after payment, or an authorized Parteienvertreter (Generalimporteur). | A person may record `RELEASE` or `BLOCK` as `human_observation` with `observedAt`. |
| NoVA 2 filing | Private person, Finanzamt Österreich. Paper appointment or a FinanzOnline upload of one PDF under sonstige Anbringen, then payment on the tax account. | Nothing. No login. |
| NoVA 1 / FinanzOnline return | Entrepreneur, at the VAT tax office. | Out of scope. NoVA 2 is the private-person form. |
| Video appointment | ID Austria, EPS, no representative on the video channel. | Not called. |

Creating a draft, exporting JSON, or running the fixtures does not require a tax advisor, a FinanzOnline account, or Parteienvertreter status.

---

## UX Compliance

Follow-up only. This PR adds no page. The panel is a section on the existing vehicle detail (`apps/core-web/src/pages/vehicles/VehicleDetail.tsx`).

- [x] Page-level actions Export, Review, and Supersede are top-right.
- [x] Top-left keeps the vehicle title, breadcrumbs, and badges.
- [x] The section header uses `text-2xl font-semibold tracking-tight`. The subtitle uses `text-slate-500` and states that the draft is not a filing.
- [x] Completeness, review state, and check status use `StatusBadge`. Allowed labels are `INCOMPLETE`, `READY_FOR_REVIEW`, `UNREVIEWED`, `REVIEWED`, `SUPERSEDED`, `UNKNOWN`, and `CHECKED`. `RELEASE` is plain text under the check, with the observed time, not a success badge.
- [x] Human fields on the draft use debounced auto-save at 750 ms with Saving/Saved. Calculated fields are read-only text.
- [x] The panel is not a list page. No create-button prefix, no DataTable, and no row delete.
- [x] Real-time sync stays off. Do not add these entities to `SUPPORTED_ENTITY_TYPES` or the dashboard entity map.
- [x] An incomplete draft renders every missing and conflict code next to the field. The export action stays available and the downloaded JSON repeats `completeness: INCOMPLETE`.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| None in this PR | | |
| `NovaAuthoritySection` | `apps/core-web/src/components/vehicles/NovaAuthoritySection.tsx` | Follow-up panel. Calls the API above. Does not calculate NoVA in the browser. |

Follow-up server modules:

| Module | Change |
|--------|--------|
| `apps/core-api/src/vehicle/nova-calculation.service.ts` | Called by the confirmation endpoint. No change to the arithmetic. |
| New `nova-authority` service beside the vehicle module | Mapper, draft lifecycle, check log. Rules live here, not in the React panel and not in an agent tool. |
| Prisma schema | Four tables above. |

No new agent action. Do not register a filing tool.

---

## Testing Plan

### Backend

The follow-up loads the three JSON files under `docs/internal/02-Feature-Specs/Vehicles/fixtures/nova-authority-preparation/`.

- `ready-factor-one` asserts all 77 `expect.fields` values, `READY_FOR_REVIEW`, warning `legal_entity_tax_number_not_used`, check `UNKNOWN`, and `documentSiteId` equal to the vehicle site rather than `sessionSiteId`. Money uses `roundMoneyEuro` on both sides. Confirmed amount is 2650.
- `scaled-wertentwicklung` asserts malus 200, Abzug 175, Rechtslage `01.01.2024 - 31.12.2024`, and amount 2625.
- A case that lists `expect.fields` asserts those keys. Other keys are not implied.
- `mapper-only` cases do not hit HTTP. They assert the scaling guard, including `component-rounding-mismatch`.
- HTTP cases assert the status and `code` in the fixture. A 201 draft fails the test if `submittedToAuthority` is true or if `filing` appears as true.
- Existing `vehicle-nova` e2e tests stay green. They do not gain a filing assertion.

### Frontend

The follow-up checks the panel in the browser: an incomplete taxpayer draft shows the missing codes, a ready draft can be reviewed only with filing left false, and the check badge stays `UNKNOWN` until a CHECKED note with a timestamp is saved. This spec PR has no page to open.

---

## Implementation follow-up

| Step | Deliverable |
|------|-------------|
| 1 | Prisma models, migration, `docs/deletion-policy.md` rows, `node tools/tenant-restore/generate-tenant-restore-sql.mjs` |
| 2 | Confirmation, mapper, draft, review, supersede, export, check endpoints against `cases.json` |
| 3 | OpenAPI and web types regenerated and committed |
| 4 | `NovaAuthoritySection` on vehicle detail |

The follow-up must not add a FinanzOnline client, a database lookup, a filing status, or an agent wait. A green export test is not a filing acceptance. No deployment and no provider call.

No ADR in that follow-up unless it breaks decision 10 by adding an authority integration.

---

## Open Questions

These do not change the fixtures.

1. **Erwerbsteuer beside NoVA.** The procedure page says import VAT is paid with NoVA. This contract leaves `form_option_fahrzeugeinzelbesteuerung` false and says so on the export. A later slice can require that section before `READY_FOR_REVIEW`. It must not mark the current draft filed.
2. **Finanzamt recipient.** Recipient fields stay optional because the product has no Finanzamt register and must not call `JsonServlet`. A later slice can require `rec_name_1` once a person maintains that address.
3. **Form revision.** The DOK page has no Stand date. The next time `fid=7888` gains, drops, or renames a field, the follow-up stops with `FORM_CONTRACT_MISMATCH` until a new spec pins a new hash. Do not hot-fix the mapper against a live fetch.

---

## References

- [NoVA EU-M1 used import](nova-eu-used-import.md)
- [NoVA Calculator](nova-calculator.md)
- [AUT-531](https://linear.app/auto-core-platform/issue/AUT-531/spec-first-nova-2-entwurf-und-genehmigungsdatenbank-prufprozess)
- [AUT-530](https://linear.app/auto-core-platform/issue/AUT-530)
- [`form-contract.json`](fixtures/nova-authority-preparation/form-contract.json)
- [`fields.json`](fixtures/nova-authority-preparation/fields.json)
- [`cases.json`](fixtures/nova-authority-preparation/cases.json)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Austria Market Roadmap](https://linear.app/auto-core-platform/project/austria-market-roadmap-30062cc45fde) |
| Milestone | E4 — NoVA import workflows |
| Issues | AUT-531 (this spec). Follow-up implementation is a separate coding issue. AUT-530 is the calculation this draft confirms. |
