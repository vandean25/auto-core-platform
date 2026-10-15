---
title: "BMD Accounting Export (ACP-BMD-AT-EUR-1)"
date: "2026-10-13"
module: "Finance"
status: implementation-draft
linear-issue: "https://linear.app/auto-core-platform/issue/AUT-351"
linear-hardening: "https://linear.app/auto-core-platform/issue/AUT-520"
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
tags: [feature-spec, finance, accounting, export, austria]
---

# BMD Accounting Export (ACP-BMD-AT-EUR-1)

## Summary

AT legal entities can export a closed period of STANDARD-VAT invoices and credit notes as a flat, semicolon-separated booking file for BMD NTCS. The file is built only from the frozen accounting allocation of each committed line, never from live revenue groups. This is a second AT profile next to RZL (AUT-350). It uses the same serializer registry, the same run, manifest, SHA-256 and storage model, and the same release-gate pattern.

Decision (Product Owner, 2026-10-12): build best-effort from public knowledge. Do not wait for an external BMD sample or an accountant approval. The earlier "spec-gated, not startable without a sample" note is superseded (AUT-364 canceled).

**Status: implementation draft, profile disabled.** The layout follows the public BMD NTCS Massentransferformat (MTF) field order where sources agree (see "Source matrix"). It is **not** verified by BMD or any accountant, and golden tests do **not** claim vendor acceptance. The release flag stays off, and no tenant enables the profile, until a BMD validation step passes (see "Open items").

## Scope

Must-have: serializer registered in the existing export serializer registry; Steuercode fields per legal entity; export-only readiness gaps; release gate; committed synthetic sample export; golden tests for a standard invoice, a margin-scheme invoice and a credit note.

Out of scope: validation against BMD NTCS (a human step, see "Open items"); enabling the profile for any tenant; UI changes; margin-scheme postings; exempt, reverse-charge and intra-community treatments; any change to RZL or DATEV behaviour; any change to issuance readiness or to the export readiness view (AUT-352 / AUT-369); purchases, payments and general-ledger balancing.

## Sources consulted

Retrieval pass **2026-10-15** (AUT-520). Earlier notes from 2026-10-13 are updated where a source could be read.

| # | Source | Version / date on document | Retrieved | Result |
|---|---|---|---|---|
| S1 | Web search: "BMD NTCS Buchungsimport ASCII CSV Schnittstelle Satzaufbau Beschreibung" | n/a | 2026-10-13 | No official BMD booking-import specification in the results. |
| S2 | Web search: "BMD NTCS import Buchungsstapel Format Semikolon Dezimalkomma Steuerschlüssel" | n/a | 2026-10-13 | No official BMD specification in the results. |
| S3 | https://invoicedataextraction.com/blog/vorbereitende-buchhaltung-bmd-rzl-datev-osterreich | Published 2026-05-25 (page metadata) | 2026-10-15 | **Read.** Describes BMD NTCS Massentransferformat (MTF) column order, semicolon-separated ASCII, `DD.MM.YYYY`, decimal-comma amounts, `S`/`H` Sollhabenkennzeichen, client-specific Steuercodes, optional `OP-Nummer`. Third-party practice article, not BMD. Committed header: `fixtures/bmd-mtf-public-header.reference.txt`. |
| S4 | https://dvo.at/PDF/ReleaseNotes/Handbuch_BuErf_Import_Fibu_(BMD_BuErf-Modul)_05102021.pdf | File name dated 2021-10-05 | 2026-10-13 | Not read (HTTP 403). BuErf is a different import path; not used for this MTF layout. |
| S5 | https://www.dvo.at/wp-content/uploads/2017/11/Import_BMD-BuErf_Neu.pdf | Marketing PDF (undated) | 2026-10-15 | **Read (summary only).** Describes BMD BuErf as a separate standard format for third-party imports into dvo Fibu. Not used for this MTF layout. |
| S6 | https://www.datev.de/.../bmd-rechnungswesen-exportanleitung.pdf | n/a | 2026-10-13 | Not read. BMD → DATEV export direction; not used. |
| S7 | help.getmoss.com, freefinance.at, integrations.pleo.io | n/a | 2026-10-13 | Unreachable from the build environment. |
| S8 | https://docs.cosmoconsult.com/de-de/business-central/bmd-ntcs-interface/doc.pdf | COSMO BMD NTCS Interface (undated) | 2026-10-15 | **Read.** Documents a **different** NTCS CSV shape (`Satzart`, `BuchSymbol`, `BuchCode` 1/2, signed amounts). Used only to record that ACP's flat eleven-field MTF is **not** that export. |
| S9 | https://www.simplesoft.at/BMD_Hilfe_Wiki/BUCHHALTUNG/NTCS_BUCHEN.pdf | BMD NTCS Fibu help (undated) | 2026-10-15 | **Read (partial).** Steuercode is client-specific; Vorsteuercode in NTCS is mandatory `2` (vs BMD 5.5). Does not define the MTF column list. |

DATEV EXTF, Lexware and RZL FIBU CSV rules describe other products. They are not evidence for BMD MTF and are not carried over.

Pinned official BMD NTCS MTF version or revision: **UNVERIFIED (no BMD-published MTF spec retrieved).** The `format_version` below remains an ACP label.

## Source matrix (ACP layout vs public evidence)

Maps each field in the pinned eleven-column MTF layout to sources. **E** = evidenced in a retrieved public document for this shape; **A** = ACP assumption only (listed in "Assumptions [UNVERIFIED]" with an ID).

| # | Field | Quoted in file | Evidence | Sources | Notes |
|---|---|---|---|---|---|
| 1 | Buchungsdatum | no | E | S3 | `DD.MM.YYYY`; ACP sets it equal to document date (closed period) — **A12**. |
| 2 | Belegdatum | no | E | S3 | `DD.MM.YYYY`. |
| 3 | Belegnummer | yes | E | S3 | Document number column in MTF list. |
| 4 | Konto | yes | E | S3 | Debtor (collective) in ACP; S8 Cosmo uses Personenkonto semantics for sales — different file shape. |
| 5 | Gegenkonto | yes | E | S3 | Revenue account of the line. |
| 6 | Betrag | no | E | S3 | Decimal comma, unsigned; credits stay positive with `H` — **A7** detail. |
| 7 | Sollhabenkennzeichen | no | A | S3, **A16** | S3 documents `S`/`H` on incoming MTF; sales-side debtor assignment is **A16** (not incoming Storno rules). |
| 8 | Steuercode | no | E | S3, S9 | Client-specific digits; ACP maps 20 / 13 / 10 % only from frozen profile — **A10**. |
| 9 | Text | yes | E | S3 | Booking text; ACP caps at 60 characters — product rule, not MTF evidence. |
| 10 | Kostenstelle | no | E | S3 | Column present; ACP always leaves it empty (not modeled). |
| 11 | OP-Nummer | yes | E | S3 | Open-item reference; S3 notes it may be optional in practice — ACP always emits it for invoices and credits — **A11**. |

**File-level properties**

| Property | Evidence | Sources | ACP pinned value |
|---|---|---|---|
| Field separator `;` | E | S3 | `;` |
| Encoding ASCII / Windows-1252 | E (ASCII) | S3 | Windows-1252, ASCII-only payload |
| Header row | A | — | None (**A2**) |
| Line endings CRLF | A | — | CRLF (**A5**) |
| Text double-quoting | A | — | Selected text fields quoted (**A9**) |
| File extension `.csv` | A | — | **A14** |
| Per-client import definition required | E | S3 | **A15** (validation still open) |

**Fixtures (synthetic vs format-evidenced)**

| Artifact | Role |
|---|---|
| `fixtures/bmd-sample-export.csv` | Hand-authored **synthetic** sample (AUT-351), predates the serializer. |
| `fixtures/bmd-mtf-evidenced-export.csv` | **Format-evidenced** pilot-customer bytes (mixed 20/13/10 % and partial credit), aligned to S3 MTF order; not vendor-validated. |
| `fixtures/bmd-mtf-public-header.reference.txt` | Verbatim MTF header line from S3. |

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
| 7 | Sollhabenkennzeichen | `S` for an invoice line, `H` for a credit line on the debtor (**A16**). | no |
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
| Golden files for a standard invoice, a margin-scheme invoice and a credit note | `bmd-ntcs-import.golden.spec.ts` (synthetic sample); AUT-520 adds format-evidenced MTF bytes and blocker regressions. |
| Manifest, immutability and SHA-256 shared with the other profiles, not duplicated | The generic run path and `accounting-export-hash.ts` are unchanged. The BMD serializer computes its SHA-256 with the same one-line hash as DATEV and RZL and adds no hash helper. |
| Expand-only migration, if strictly needed | Not needed. No schema change. |
| RZL and DATEV behaviour unchanged | The existing AUT-350 and DATEV suites pass without edits to their assertions. |
| Profile disabled by default, documented in the deferral log | `accounting-profile/bmd-profile.codes.ts` (flag default off), `.env.example`, `docs/internal/.architecture/deferrals.md`. |

## Assumptions [UNVERIFIED]

Items below are **not** confirmed by BMD. Where AUT-520 found public third-party evidence (source matrix), the assumption is narrowed or retired; the ID is kept for traceability.

| ID | Assumption | Status after AUT-520 | Basis |
|---|---|---|---|
| A1 | Eleven MTF fields in the order Buchungsdatum … OP-Nummer. | **Evidenced (third-party)** — implemented as pinned layout | S3 MTF list; `BMD_MTF_PUBLIC_FIELD_NAMES` / `fixtures/bmd-mtf-public-header.reference.txt`. |
| A2 | No header or trailer record. | **Still unverified** | S3 shows data columns only; per-client profiles may require a header row. |
| A3 | Field separator `;`. | **Evidenced (third-party)** | S3. |
| A4 | ASCII payload (Windows-1252 compatible). | **Evidenced (third-party)** for ASCII | S3; ACP rejects non-ASCII. |
| A5 | Line endings CRLF. | **Still unverified** | ACP pins CRLF; not stated in S3. |
| A6 | Dates `DD.MM.YYYY`. | **Evidenced (third-party)** | S3. |
| A7 | Amounts: decimal comma, two places, unsigned; credits use `H`. | **Evidenced (third-party)** for comma format; unsigned + `H` is ACP sales convention | S3; Cosmo S8 uses signed amounts in a different CSV shape — not mixed into this layout. |
| A8 | MTF uses `S` and `H` as Sollhabenkennzeichen values. | **Evidenced (third-party)** for the values only | S3. |
| A16 | For Ausgangsrechnung / Gutschrift export, `S`/`H` refer to the collective debtor line (`S` invoice, `H` credit). | **Still unverified** (ACP sales convention) | S3 describes incoming MTF and allows negative amounts or S/H swap per profile; not sales export proof. |
| A9 | Double quotes around text fields; numeric/date/flag unquoted. | **Still unverified** | ACP pins quoting; S3 does not describe quoting. |
| A10 | Steuercode digits are client-specific; 20/13/10 % map from profile only. | **Evidenced (client-specific)**; gross-derived VAT split **unverified** | S3, S9. |
| A11 | `OP-Nummer` links invoice and credit open items. | **Partially evidenced** — column exists; ACP always fills it | S3 (optional in practice). |
| A12 | Booking date equals document date. | **Still unverified** (ACP closed-period rule) | Product rule. |
| A13 | Plain numeric account strings from frozen allocation. | Fixture / UGB convention | Pilot fixtures only. |
| A14 | `.csv` extension accepted. | **Still unverified** | ACP file naming only. |
| A15 | Client-specific import definition must match layout. | **Evidenced (process)**; match not tested | S3. |

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
