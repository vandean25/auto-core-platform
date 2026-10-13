---
title: "BMD Accounting Export (ACP-BMD-AT-EUR-1)"
date: "2026-10-13"
module: "Finance"
status: implementation-draft
linear-issue: "https://linear.app/auto-core-platform/issue/AUT-351"
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
tags: [feature-spec, finance, accounting, export, austria]
---

# BMD Accounting Export (ACP-BMD-AT-EUR-1)

## Summary

AT legal entities can export a closed period of STANDARD-VAT invoices and credit notes as a flat, semicolon-separated booking file for BMD NTCS. The file is built only from the frozen accounting allocation of each committed line, never from live revenue groups. This is a second AT profile next to RZL (AUT-350). It uses the same serializer registry, the same run, manifest, SHA-256 and storage model, and the same release-gate pattern.

Decision (Product Owner, 2026-10-12): build best-effort from public knowledge. Do not wait for an external BMD sample or an accountant approval. The earlier "spec-gated, not startable without a sample" note is superseded (AUT-364 canceled).

**Status: implementation draft, profile disabled.** The layout is ACP's own pinned reading of a BMD booking import. It is **not** verified against BMD, and no BMD documentation could be retrieved while this was written (see "Sources consulted"). The release flag stays off, and no tenant enables the profile, until a BMD validation step passes (see "Open items").

## Scope

Must-have: serializer registered in the existing export serializer registry; Steuercode fields per legal entity; export-only readiness gaps; release gate; committed synthetic sample export; golden tests for a standard invoice, a margin-scheme invoice and a credit note.

Out of scope: validation against BMD NTCS (a human step, see "Open items"); enabling the profile for any tenant; UI changes; margin-scheme postings; exempt, reverse-charge and intra-community treatments; any change to RZL or DATEV behaviour; any change to issuance readiness or to the export readiness view (AUT-352 / AUT-369); purchases, payments and general-ledger balancing.

## Sources consulted

Consulted on 2026-10-13 from the build environment.

| # | Source | Result |
|---|---|---|
| S1 | Web search: "BMD NTCS Buchungsimport ASCII CSV Schnittstelle Satzaufbau Beschreibung" | No official BMD booking-import specification in the results. Other hits describe DATEV, Lexware or other products. |
| S2 | Web search: "BMD NTCS import Buchungsstapel Format Semikolon Dezimalkomma Steuerschlüssel" | No official BMD specification in the results. Hits included a dvo.at handbook "Handbuch BuErf Import Fibu (BMD BuErf-Modul)" (file name dated 2021-10-05) and a dvo.at "Import_BMD-BuErf_Neu.pdf". |
| S3 | https://invoicedataextraction.com/blog/vorbereitende-buchhaltung-bmd-rzl-datev-osterreich | Search excerpt only. Fetch refused (HTTP 403 on CONNECT from the egress proxy). Used only as an unverified lead for the field list in A1. |
| S4 | https://dvo.at/PDF/ReleaseNotes/Handbuch_BuErf_Import_Fibu_(BMD_BuErf-Modul)_05102021.pdf | Not read. Fetch refused (HTTP 403). BuErf is a different import path from the booking batch described here, so its layout is not assumed. Candidate for the validation step. |
| S5 | https://www.dvo.at/wp-content/uploads/2017/11/Import_BMD-BuErf_Neu.pdf | Not read. Fetch refused (HTTP 403). |
| S6 | https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/steuerberater/rechnungswesen/exportanleitungen/bmd-rechnungswesen-exportanleitung.pdf | Not read. It describes exporting from BMD toward DATEV, the reverse direction. Not used for this layout. |
| S7 | help.getmoss.com ("customise bmd export format"), freefinance.at (export Einzelbelege), integrations.pleo.io (BMD) | Not read. Hosts unreachable from the build environment. |

DATEV EXTF rules (semicolon separator, decimal comma) and Lexware help pages describe other products. They are not evidence for BMD and are not carried over.

Pinned official BMD version or revision: **UNVERIFIED (none retrieved).** The format identifier below is an ACP label, not a BMD version.

## Pinned specification (ACP draft)

| Item | Pinned value |
|---|---|
| Layout identifier (`format_version`) | `BMD-NTCS-ASCII-IMPORT-ACP-DRAFT-1`. An ACP label, not a BMD-published version. |
| Encoding | Windows-1252 (ANSI) bytes, no BOM. Text is limited to printable ASCII (0x20 to 0x7E), so the bytes are identical under ASCII and Windows-1252. Any other character blocks the run. |
| Field separator | `;` |
| Text quoting | Text fields are wrapped in double quotes. Embedded `;`, `"`, CR and LF, and a leading `=`, `+`, `-` or `@`, are rejected, not escaped (formula safety, as in RZL). Numeric, date and flag fields are not quoted. |
| Numbers | Amounts use a decimal comma, two places, no thousands separator, unsigned. Credits keep positive amounts and use `H`. |
| Dates | `DD.MM.YYYY` |
| Header and trailer | None. The file is a flat list of booking records. |
| Line endings | CRLF after every record, including the last. |
| Limits | 10,000 documents and 20 MiB encoded per run (same as DATEV and RZL). |
| File name | `BMD_<legal-entity-id>_<from>_<to>_<run-id>.csv` |

## Record layout (ACP draft)

One record per frozen line allocation with a non-zero gross. Eleven fields, in this order:

| # | Field | Source and rule | Quoted |
|---|---|---|---|
| 1 | Buchungsdatum | Document date, `DD.MM.YYYY`. The period is closed, so the booking date equals the document date. | no |
| 2 | Belegdatum | Document date, `DD.MM.YYYY` | no |
| 3 | Belegnummer | The document's own number (`RE-…` or `CN-…`) | yes |
| 4 | Konto | Frozen collective debtor account (`default_debtor_account`) | yes |
| 5 | Gegenkonto | Frozen revenue account of the line's allocation | yes |
| 6 | Betrag | Frozen gross of the line, decimal comma, positive | no |
| 7 | Sollhabenkennzeichen | `S` for an invoice line, `H` for a credit line. Refers to the side of Konto (the debtor). | no |
| 8 | Steuercode | BMD tax key for the line's frozen VAT rate, read from the run's frozen profile snapshot | no |
| 9 | Text | Deterministic booking text: `RE <number>`, or `CN <number> / RE <original number>` for a credit. The candidate step cuts it to 60 characters for every profile, so a long number shortens this field. OP-Nummer keeps the full number. | yes |
| 10 | Kostenstelle | Always empty. Cost centers are not modeled. | no |
| 11 | OP-Nummer | Open-item reference: the invoice's own number, or the original invoice number for a credit | yes |

Zero-gross lines are not written. They stay in the manifest and in the counts, as in DATEV and RZL. Rows keep the candidate sort order: date, kind, number, then ID.

Example, from the committed synthetic sample `apps/core-api/src/finance/accounting-export/fixtures/bmd-sample-export.csv` (fixture values, not production data):

```text
10.01.2026;10.01.2026;"RE-2026-0001";"2000";"8400";120,00;S;5020;"RE RE-2026-0001";;"RE-2026-0001"
10.01.2026;10.01.2026;"RE-2026-0001";"2000";"8300";56,50;S;5013;"RE RE-2026-0001";;"RE-2026-0001"
10.01.2026;10.01.2026;"RE-2026-0001";"2000";"8200";33,00;S;5010;"RE RE-2026-0001";;"RE-2026-0001"
15.01.2026;15.01.2026;"RE-2026-0002";"2000";"8400";240,00;S;5020;"RE RE-2026-0002";;"RE-2026-0002"
20.01.2026;20.01.2026;"CN-2026-0001";"2000";"8300";22,60;H;5013;"CN CN-2026-0001 / RE RE-2026-0001";;"RE-2026-0001"
```

## Tax keys (Steuercodes)

| Code | Meaning in this profile |
|---|---|
| 20%, 13%, 10% | Configured per legal entity at `serializerParams.bmd.steuercodes.vat20`, `vat13` and `vat10`. Digits only, 1 to 4 characters. No default: the field stays empty until an admin saves it. BMD tax keys are client-specific, so the same digits can mean different things in another BMD client. |
| Exempt, reverse-charge, intra-community | Not implemented. ACP emits no tax key for them. |
| Any other rate | Blocked with `UNSUPPORTED_EXPORT_TAX_MODE`. |

Steuercodes are read only from the run's frozen `profile_snapshot`, so a later settings change never rewrites an existing run. This change adds no UI. The values are set through the accounting profile API.

## Open-item (OP) handling

- Each invoice line opens an open item: `OP-Nummer` is the invoice number, `Sollhabenkennzeichen` is `S`.
- Each credit line reduces that open item: `OP-Nummer` is the original invoice number, `Sollhabenkennzeichen` is `H`.
- ACP never emits payment, clearing or refund records, and it emits no due dates.
- The draft has no separate open-item mode column (RZL's `E`/`M` is not used here). This is assumption A8.

## Zero-rate (0%) decision

The same decision as RZL (AUT-350). A line with VAT rate 0.00 and a non-zero gross blocks the whole run with `UNSUPPORTED_EXPORT_TAX_MODE`. A zero-gross line is ignored. Reason: ADR-0023 forbids inferring an exempt, reverse-charge or intra-community treatment from a zero tax amount or from the country. The serializer repeats the check: a rate without a BMD tax key throws, and no run is stored.

## Margin scheme

Margin-scheme invoices and credit notes are blocked with `UNSUPPORTED_EXPORT_TAX_MODE`, as in RZL and DATEV. ADR-0023 requires an approved posting fixture before margin export. The golden test pins this blocker outcome, and a period that contains margin documents produces no file.

## Other profile rules

- **Country:** only AT allocations. A DE allocation blocks with `UNSUPPORTED_EXPORT_COUNTRY`. The profile can be enabled only for AT legal entities (400 otherwise).
- **Tax treatment:** a DATEV BU key (`manual_bu`) on a line with a non-zero gross blocks with `ACCOUNTING_MAPPING_INCOMPLETE`. Automatic tax is driven by the Steuercode only. A manual BU allocation on a zero-gross line is not written, so for BMD it does not block. RZL blocks such an allocation on any line, because its check runs before the gross test.
- **Text:** the debtor and revenue accounts must be printable ASCII without `;` or quotes. Otherwise the block is `ACCOUNTING_MAPPING_INCOMPLETE` and preview shows it. The document numbers come from the invoice and credit note numbering, and ACP builds the booking text as `RE <number>` or `CN <number> / RE <original number>`. The serializer checks each of these fields again. It refuses the run with a plain error, and no run is stored, when a document number or booking text is not printable ASCII, contains `;` or a quote, or starts with `=`, `+`, `-` or `@`. It also refuses booking text over 60 characters, which cannot occur from the run path because the candidate step cuts the text first. Preview does not check document numbers or booking text, so it shows no blocker for them, as in RZL.
- **Formats are per profile:** amounts, dates and the account-length check are BMD's own pinned assumptions (A6, A7, A13). They are written apart from the RZL and DATEV formatters rather than imported from them, so a BMD validation outcome cannot change RZL or DATEV output. Consolidating the three is a separate change.
- **Chart and account length:** chart `UGB` or `EA`, the same AT catalogue as RZL. Account length 1 to 8.
- **Debtor convention:** one collective debtor account per legal entity (`default_debtor_account`). No per-customer debtor accounts, as in ADR-0023.
- **Export-only gaps:** a missing Steuercode for 20%, 13% or 10%, the format identifier, chart, account length or default debtor account. They appear in `export_missing_fields` and as a global blocker in preview and generation. They are not part of `mapping_readiness`, so issuance is unaffected.
- **Known gap (out of scope, AUT-369):** the export readiness view (AUT-352) still counts RZL gaps only (`profileExportGapCount`). For a BMD profile it shows no gaps, while preview and generation do block on BMD gaps. Changing that view is not part of this change.

## Release gate

- Environment variable `ACCOUNTING_EXPORT_BMD_SERIALIZER_ENABLED`, default **off**. It is listed in `.env.example` and in the env schema.
- Flag off: the profile cannot be enabled (400). Preview reports `canGenerate = false`. Generation returns 422 `EXPORT_PROFILE_DISABLED`. The serializer itself refuses to run. A flag switched off after a preview still fails closed.
- Flag on: the profile may be enabled for an AT entity once its export configuration is complete. `is_enabled` stays false by default.
- Production keeps the flag off until BMD validation passes.

## Manifest, immutability and SHA-256

Unchanged. The BMD profile uses the same generic export service as DATEV and RZL:

- the document manifest is built from frozen snapshot hashes, and the preview hash is computed over that manifest;
- the run is an immutable `AccountingExport` row with the exact bytes, the SHA-256, the frozen profile snapshot and the actor and time;
- a repeat download returns the same bytes;
- the SHA-256 is the hash of the encoded bytes, computed with the same one-line Node hash that the DATEV and RZL serializers use. No new hash helper is added.

## Authorization, replay and storage

Unchanged from [[datev-accounting-export]] and [[rzl-accounting-export]]: OWNER or ADMIN with an active membership at every contributing site, closed periods only, one legal entity per run, immutable run with exact bytes.

## Database impact

None. `profile_code` is a free-text column, and BMD Steuercodes live in the existing `serializer_params` JSON column. No migration is added.

## API contract

`serializerParams.bmd` is added to the profile DTO. The `serializer_released` and `export_missing_fields` descriptions name BMD. `apps/core-api/openapi/openapi.json` and `apps/core-web/src/api/generated/openapi.ts` are regenerated. No UI change.

A BMD profile needs `formatVersion` set to `BMD-NTCS-ASCII-IMPORT-ACP-DRAFT-1`, sent in the same request as the profile code. Nothing sets it for BMD: the AT default is the RZL identifier, and a profile code change keeps the stored value. Until the BMD identifier is saved, `format_version` is listed in `export_missing_fields`, blocks preview and generation, and blocks enablement.

## Acceptance mapping (AUT-351)

| Criterion | Evidence |
|---|---|
| Spec from public BMD sources, with pinned sources, encoding, separators, date and amount formats, tax-code and account mapping, and an Assumptions [UNVERIFIED] section | This document: "Sources consulted", "Pinned specification", "Record layout", "Assumptions [UNVERIFIED]". |
| Synthetic sample committed before serializer code | `fixtures/bmd-sample-export.csv`, committed in the first commit of this change, before `bmd-ntcs-import.serializer.ts`. |
| Serializer on the AUT-350 registry, behind the same release-gate pattern, disabled by default | `accounting-export-serializer.registry.ts`, `accounting-export-serializers.ts`, `bmd-accounting-export.serializer.ts`, `accounting-profile/bmd-profile.codes.ts`, `accounting-profile/accounting-export-release.ts`. Gate tests: `bmd-profile.gate.spec.ts`. |
| Golden files for a standard invoice, a margin-scheme invoice and a credit note | `bmd-ntcs-import.golden.spec.ts`. |
| Manifest, immutability and SHA-256 shared with the other profiles, not duplicated | The generic run path and `accounting-export-hash.ts` are unchanged. The BMD serializer computes its SHA-256 with the same one-line hash as DATEV and RZL and adds no hash helper. |
| Expand-only migration, if strictly needed | Not needed. No schema change. |
| RZL and DATEV behaviour unchanged | The existing AUT-350 and DATEV suites pass without edits to their assertions. |
| Profile disabled by default, documented in the deferral log | `accounting-profile/bmd-profile.codes.ts` (flag default off), `.env.example`, `docs/internal/.architecture/deferrals.md`. |

## Assumptions [UNVERIFIED]

Every item below is ACP's assumption about BMD NTCS. None is confirmed by a BMD document.

| ID | Assumption | Basis |
|---|---|---|
| A1 | Booking records have these eleven fields, in this order: Buchungsdatum, Belegdatum, Belegnummer, Konto, Gegenkonto, Betrag, Sollhabenkennzeichen, Steuercode, Text, Kostenstelle, OP-Nummer. | Search excerpt of a third-party description of a BMD mass-transfer format (S3). Not fetched. |
| A2 | No header or trailer record. | S3 does not mention one. BMD import definitions are client-specific, so a header may be required. |
| A3 | The field separator is `;`. | S3 describes a semicolon-delimited file. The DATEV convention is not evidence for BMD. |
| A4 | The bytes are Windows-1252. ACP writes ASCII only, so ASCII and Windows-1252 are equivalent for this file. | S3 describes an ASCII file. |
| A5 | Line endings are CRLF. | Windows software default. Unverified. |
| A6 | Dates are `DD.MM.YYYY`. | Austrian convention. Unverified. |
| A7 | Amounts use a decimal comma, two places, unsigned. | Austrian convention. Unverified. |
| A8 | `S` and `H` describe the side of Konto (the debtor). `S` is an invoice and `H` a credit. | S3 names a debit/credit indicator but not its values. |
| A9 | Double quotes are accepted around text fields. Numeric, date and flag fields are unquoted. | Unverified. |
| A10 | The BMD tax key (Steuercode) is 1 to 4 digits, defined per client. BMD derives the VAT split from the gross amount and the key. | S3: each client defines its own tax codes. The derivation is unverified. |
| A11 | `OP-Nummer` links the open items of an invoice and its credit. | S3 lists an open-item number field. Semantics unverified. |
| A12 | The booking date equals the document date. | Closed periods. Unverified. |
| A13 | Account numbers are plain numeric strings from the frozen allocation. The fixture uses 4-digit UGB-style numbers, which are fixture values and not production defaults. | Fixture. |
| A14 | `.csv` is accepted as the import file extension. | Unverified. |
| A15 | A client-specific BMD import definition is required, and it must match this layout. | S3: mandatory columns can be customized per client. |

## Open items: BMD validation before any enablement

No validation ticket is created by this change. The owner must create one; no issue ID is invented here.

1. Obtain BMD NTCS import documentation for the target BMD version, or the firm's import definition. Record the version and date in this section.
2. Confirm field order, separator, quoting, header, date and decimal format, encoding, `S`/`H` semantics, OP semantics and Steuercode semantics against that documentation.
3. Run a test import into a non-production BMD client. Compare the imported gross, net and tax totals per tax key with the frozen facts.
4. Decide the zero-rate and margin treatment with the accountant. Confirm whether BU-Schlüssel (manual) mapping is ever needed.
5. Only after items 1 to 4 pass may the release flag be considered, and then only for a non-production environment.

## References

- [[rzl-accounting-export]] (sibling AT profile, AUT-350), [[datev-accounting-export]], [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]].
- Deferral log: `docs/internal/.architecture/deferrals.md`.
- Source: `apps/core-api/src/finance/accounting-export/bmd-ntcs-import.serializer.ts`, `bmd-format.constants.ts`; `apps/core-api/src/finance/accounting-profile/bmd-profile.codes.ts`, `accounting-export-release.ts`, `accounting-profile-export-gaps.ts`.
