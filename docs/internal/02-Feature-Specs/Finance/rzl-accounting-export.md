---
title: "RZL Accounting Export (ACP-RZL-AT-EUR-1)"
date: "2026-10-12"
module: "Finance"
status: implementation-draft
linear-issue: "https://linear.app/auto-core-platform/issue/AUT-350"
linear-hardening: "https://linear.app/auto-core-platform/issue/AUT-521"
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
tags: [feature-spec, finance, accounting, export, austria]
---

# RZL Accounting Export (ACP-RZL-AT-EUR-1)

## Summary

AT legal entities export a closed period of STANDARD-VAT invoices and credit notes as an RZL FIBU import CSV. The file is built only from the frozen accounting allocation of each committed line, never from live revenue groups. This spec covers AUT-350 steps 2 to 5: pinned specification, serializer, per-entity profile configuration with a settings UI, and a release gate that keeps the profile disabled.

It depends on [[datev-accounting-export]] (run, replay and authorization model), [[legal-invoicing-and-credit-notes]], and [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]]. It follows ADR-0023's rule that a supported PDF does not imply a supported accounting export.

**Status: implementation draft, profile disabled.** The on-disk file is ACP's own **K/C/B draft** layout (`RZL-FIBU-IMPORT-ACP-DRAFT-1`), not RZL's published Euro-Version column file. Public handbook sources are mapped in the source matrix below (AUT-521). Golden tests do **not** claim vendor acceptance. Real import validation remains a human step (see "Open items"); **AUT-361** and **AUT-368** stay cancelled — engineering does not wait on them. Until an import validation passes, the platform flag stays off and no production tenant enables the profile.

## Scope

Must-have: serializer registered in the existing export serializer registry; profile fields for firm number and Steuercodes per legal entity; export-only readiness gaps; settings UI; generation blocked unless the release flag is on; committed sample export with golden tests.

Out of scope: real RZL import validation (AUT-368); enabling the profile for any tenant; margin-scheme postings; exempt, reverse-charge and intra-community treatments; BMD (AUT-351); the margin snapshot work (AUT-349); the lift of the export block (AUT-369); purchases, payments and general-ledger balancing.

## Sources consulted

Retrieval pass **2026-10-15** (AUT-521). Earlier AUT-350 notes are updated where a source could be read.

| # | Source | Version / date on document | Retrieved | Result |
|---|---|---|---|---|
| S1 | https://rzlsoftware.at/fileadmin/user_upload/PDF_Schnittstelle/RZL_FIBU_Import_Schnittstelle.pdf | Title metadata: **August 2026** (`RZL FIBU Import Schnittstelle August 2026`); PDF `Last-Modified` 2026-08-12 | 2026-10-15 | **Read.** Official RZL handbook *Datenimport Buchungen (Euro-Version)*: semicolon-separated variable-length rows, CRLF, Codepage 1252, 41 booking columns (chapter 2.2.1), `Belegkreis` `AR` on Ausgangsrechnung examples, numeric `Buchungsart` `1` with Gegenbuchung, `USt-Schlüssel` / `USt-Code` pair, separate Soll/Haben/Steuer amounts. Committed field list: `fixtures/rzl-fibu-euro-public-fields.reference.txt`; handbook line: `fixtures/rzl-fibu-public-ausgangsrechnung.reference.txt`. |
| S2 | Third-party BMD/RZL practice articles (invoicedataextraction.com, etc.) | n/a | 2026-10-13 | Not used for RZL layout evidence (BMD MTF is AUT-520). |
| S3 | Live RZL import on a tenant installation | n/a | not tried | Out of scope for AUT-521. No vendor acceptance claimed. |

Pinned official revision for the **Euro-Version** import: **August 2026 handbook (S1).** ACP still emits the separate **draft** file shape below; it is not a byte-compatible export of S1.

## Source matrix (ACP K/C/B draft vs public evidence)

Maps each ACP draft field to handbook evidence. **E** = evidenced in S1 for the official shape; **A** = ACP assumption only (see "Assumptions [UNVERIFIED]").

| ACP record / field | Evidence | Sources | Notes |
|---|---|---|---|
| File encoding Windows-1252 | E | S1 (chapter intro, *Allgemeines zur RZL FIBU/EA Import Schnittstelle*) | ACP rejects non–Win-1252 text. |
| Field separator `;` | E | S1 §1.2.1 | Semicolon; text must not contain `;`. |
| Line endings CRLF | E | S1 §1.2.1 | Trailing CRLF after last record (**A5** detail for draft file). |
| Header `K` + column `C` + booking `B` | A | — | **A1.** Official import is a flat 41-column row per line; no K/C/B records in S1. |
| Header firm number (`Firmennummer`) | A | — | **A2.** Not in S1 booking columns; ACP profile field. |
| Header period dates `DD.MM.YYYY` | A | S1 | Official `Beleg-Datum` is `TTMMJJJJ` (**A6**). |
| `BUCHUNGSART` `AR` / `AG` | A | S1 | S1 uses numeric `Buchungsart` (e.g. `1`) and `Belegkreis` `AR` on sales examples; credits use `AR` + signed amounts, not `AG` (**A3**, **A4**). |
| `BELEGDATUM` `DD.MM.YYYY` | A | S1 | Official date format differs (**A6**). |
| `BELEGNUMMER` quoted document number | A | S1 | Official `Belegnummer` is alphanumeric, often unquoted in examples (**A7**). |
| `SOLL_HABEN` + unsigned `BETRAG` | A | S1 | Official rows use `Sollbetrag` / `Habenbetrag` and signed `Steuerbetrag` on credits (**A8**). |
| `KONTO` / `GEGENKONTO` one gross line per allocation | A | S1 examples, **A13** | Handbook uses a personenkonto line plus a separate Gegenbuchung line (net + tax). ACP collapses to one unsigned gross line; production uses a collective debtor (ADR-0023). Evidenced fixture rows use handbook account numbers. |
| `STEUERCODE` from profile | A | S1 | Official pair is `USt-Schlüssel` + `USt-Code` (**A9**). |
| `BUCHUNGSTEXT` (60 chars) | A | S1 | Handbook max 40 chars per line (**A10**). |
| `OP_BELEGNUMMER` + `OP_MODUS` `E`/`M` | A | S1 | Official `OP-Nummer` is numeric on personenkonto lines (**A11**, **A12**). |
| `KOSTENSTELLE` empty | E (optional column) | S1 | Column exists; ACP leaves it empty. |

**Fixtures (synthetic vs format-evidenced)**

| Artifact | Role |
|---|---|
| `fixtures/rzl-sample-export.csv` | **Synthetic** committed sample (AUT-350). |
| `fixtures/rzl-golden-*.csv` | **Synthetic** per-scenario bytes (invoice/credit rates, mixed partial credit). |
| `fixtures/rzl-draft-evidenced-export.csv` | **Format-evidenced** ACP draft bytes; row amounts/accounts/dates from handbook §2.3 single-rate examples (not the AUT-350 mixed synthetic sample). |
| `fixtures/rzl-draft-evidenced-gutschrift-only.csv` | **Format-evidenced** single-document file for the handbook Gutschrift example. |
| `fixtures/rzl-acp-draft-columns.reference.txt` | Committed `C` record column order for the ACP draft (independent of per-run serializer joins). |
| `fixtures/rzl-fibu-euro-public-fields.reference.txt` | Verbatim 41-column handbook order from S1. |
| `fixtures/rzl-fibu-public-ausgangsrechnung.reference.txt` | Handbook Ausgangsrechnung example line (parsed without the ACP serializer). |

## Pinned specification (ACP draft file)

| Item | Pinned value |
|---|---|
| Source document (official, for mapping only) | RZL FIBU Import Schnittstelle (S1, August 2026) |
| On-disk layout identifier (header record) | `RZL-FIBU-IMPORT-ACP-DRAFT-1`. ACP label; **not** S1's Euro-Version row shape. |
| Encoding | Windows-1252 (ANSI), no BOM. Characters outside Windows-1252 block the run. |
| Field separator | `;` |
| Text quoting | Text fields are wrapped in double quotes. Embedded `;`, `"`, CR and LF are rejected, not escaped. Leading `=`, `+`, `-` or `@` is rejected (formula safety). |
| Numbers | Amounts use a decimal comma, two places, no thousands separator, unsigned. Credits keep positive amounts and use polarity `H`. |
| Dates | `DD.MM.YYYY` (document and period dates) — **ACP draft (A6)** |
| Creation timestamp | `YYYYMMDDHHmmss` in UTC, frozen at run creation — **ACP draft (A2)** |
| Line endings | CRLF, with a trailing CRLF after the last record |
| Limits | Same as DATEV: 10,000 documents and 20 MiB encoded per run |

## Record layout (ACP draft)

The file has one header record `K`, one column-name record `C` and one booking record `B` per frozen line allocation. There is no trailer.

Header `K` (9 fields): `K`, format identifier, firm number (`Firmennummer`, from the profile), creation timestamp, period start, period end, currency `EUR`, chart (`UGB`), account length.

Column record `C`: the names of the booking fields below, in the same positions.

Booking record `B` (13 fields):

| Field | Source and rule |
|---|---|
| SATZART | Constant `B` |
| BUCHUNGSART | `AR` for an invoice, `AG` for a credit note (see Buchungsarten) |
| BELEGDATUM | Frozen document date, `DD.MM.YYYY` |
| BELEGNUMMER | The document's own number (`RE-…` or `CN-…`), quoted |
| SOLL_HABEN | `S` for an invoice line, `H` for a credit line. Must match the document kind. |
| BETRAG | Frozen gross of the line, decimal comma, positive |
| KONTO | Frozen debtor account (the collective debtor, see Debtor convention) |
| GEGENKONTO | Frozen revenue account of the line's allocation |
| STEUERCODE | RZL Steuercode for the line's frozen VAT rate, read from the run's frozen profile snapshot |
| BUCHUNGSTEXT | The existing deterministic booking text (60 characters at most), quoted |
| OP_BELEGNUMMER | Open-item reference: the invoice's own number, or the original invoice number for a credit |
| OP_MODUS | `E` (open item opened, invoice) or `M` (open item reduced, credit) |
| KOSTENSTELLE | Always empty. Cost centers are not modeled; `costCenterLength` is stored but not emitted. |

Zero-gross lines are not written. They are kept in the manifest and counts, as in DATEV. The rows keep the order of the candidate sort: date, then kind, then number, then ID.

## Steuercodes

| Code | Meaning in this profile |
|---|---|
| `20`, `13`, `10` | Configured per legal entity for 20%, 13% and 10% STANDARD VAT (`serializerParams.rzl.steuercodes.vat20/vat13/vat10`). Digits only, 1 to 4 characters. No value is stored by default. The UI offers "Use suggested codes 20 / 13 / 10", which only fills the form until the admin saves. |
| `01`, `02`, `03` | **Reserved and not implemented.** ACP reads these as the exempt, reverse-charge and intra-community treatments that ADR-0023 defers. Nothing in ACP emits them. |
| Any other rate | Blocked with `UNSUPPORTED_EXPORT_TAX_MODE`. |

The export reads Steuercodes only from the run's frozen profile snapshot (`profile_snapshot`), so a later settings change never rewrites an existing run.

## Buchungsarten

| Code | Document |
|---|---|
| `AR` | Ausgangsrechnung: a committed invoice (FINALIZED, ISSUED or PAID) |
| `AG` | Ausgangsgutschrift: a finalized credit note. Its title in ACP is still a commercial correction (`Rechnungskorrektur` or `Stornorechnung`), not a self-billing Gutschrift. |

These codes are ACP draft labels. S1 uses `Belegkreis` `AR` on sales invoice **and** Gutschrift examples, with numeric `Buchungsart` `1` — not `AG` (**A3**, **A4**).

## Open-item (OP) handling

- Each invoice line opens an open item in the collective debtor account: `OP_MODUS = E` and `OP_BELEGNUMMER` = the invoice's number.
- Each credit line reduces that open item: `OP_MODUS = M` and `OP_BELEGNUMMER` = the original invoice number, so the accountant can match it. A full or partial credit uses the same rule.
- ACP never emits payment, clearing or refund records. A `PAID` invoice keeps its invoice rows, and the `PAID` status adds no payment row.
- Due dates are not emitted. Whether RZL needs them is open (AUT-368).

## Zero-rate (0%) decision

**Decision (best-effort, recorded as AUT-350 requires; no accountant wait):** a line with VAT rate 0.00 and a non-zero gross **blocks the whole run** with `UNSUPPORTED_EXPORT_TAX_MODE`. A zero-gross zero-rate line is ignored and does not block.

Reasons: ADR-0023 forbids inferring an exempt, reverse-charge or intra-community treatment from a zero tax amount or from the country. Mapping 0% to codes `01`, `02` or `03` needs an approved treatment decision for the specific case. Until one exists, ACP fails closed, which matches the rule that an export never silently drops or partially includes documents. AUT-368 confirms or changes this decision.

## Other profile rules

- **Country:** only AT allocations. A DE allocation on the RZL profile blocks with `UNSUPPORTED_EXPORT_COUNTRY`. The RZL profile can be enabled only for AT legal entities.
- **Tax treatment:** DATEV BU keys (`manual_bu`) are not used by RZL and block with `ACCOUNTING_MAPPING_INCOMPLETE`. RZL rows use Steuercodes only, so a row can never carry both mechanisms.
- **Margin scheme:** blocked as before (`UNSUPPORTED_EXPORT_TAX_MODE`).
- **Debtor convention:** one collective debtor account per legal entity (`default_debtor_account`). Per-customer debtor accounts are not emitted, as in ADR-0023.
- **Revenue accounts:** from each frozen allocation, set by the mapping rules. No live revenue-group lookup happens at export time.
- **Global export blockers** (`ACCOUNTING_MAPPING_INCOMPLETE`, no document attached) appear in preview and block generation while any of these is missing: firm number, a Steuercode for 20%, 13% or 10% VAT, the pinned format identifier `RZL-FIBU-IMPORT-ACP-DRAFT-1`, chart, account length or default debtor account. The UI pins the format identifier when the profile code is RZL.
- **Issuance is unaffected.** RZL export settings are not part of `mapping_readiness`, which gates issuance. AT entities already default to the RZL profile code, so putting these fields there would have blocked invoicing.

## Release gate

- Environment variable `ACCOUNTING_EXPORT_RZL_SERIALIZER_ENABLED`, default **off** (listed in `.env.example` and the env schema).
- Flag off: the profile cannot be enabled (400); preview reports `canGenerate = false`; generation returns 422 `EXPORT_PROFILE_DISABLED`; the serializer itself refuses to run. A flag switched off after a preview still fails closed.
- Flag on: the profile may be enabled for an AT entity once its export configuration is complete. `is_enabled` stays false by default.
- Production must keep the flag off until AUT-368 passes.

## Authorization, replay and storage

Unchanged from [[datev-accounting-export]]: OWNER/ADMIN with an active membership at every contributing site; closed periods only; one legal entity per run; immutable run with exact bytes, SHA-256 and frozen profile; repeat downloads return the same bytes. The filename is `RZL_<legal-entity-id>_<from>_<to>_<run-id>.csv`.

## Database impact

None. Firm number and Steuercodes are stored in the existing `serializer_params` JSON column, which already carries `rzl.firmNumber` and `rzl.costCenterLength`. No migration is added, so the expand-only rule is met trivially. New blockers reuse existing codes. The OpenAPI contract gains `serializer_released`, `export_missing_fields` and `serializer_params.rzl.steuercodes`.

## Acceptance mapping (AUT-350)

| Criterion | Evidence |
|---|---|
| Serializer per public RZL docs; flag default off | Source matrix + S1 (August 2026); ACP draft file is **not** byte-compatible with S1. Release gate: `accounting-export-serializer.registry.spec.ts`, `accounting-profile.validation.spec.ts`. |
| Sample export committed, with a note that real validation is AUT-368 | `accounting-export/fixtures/rzl-sample-export.csv` and `fixtures/README.md`; `rzl-sample-export.spec.ts` pins the bytes. |
| DATEV golden tests and bytes unchanged | `datev-serializer.golden.spec.ts` and `datev-serializer.spec.ts` are untouched. The DATEV candidate messages are unchanged (`accounting-export-candidates.rzl.spec.ts`). |
| Golden files for 20%, 13% and 10% invoices and credit notes; positive amounts with opposite polarity; 13% fixture | `rzl-fibu-import.golden.spec.ts` + committed `fixtures/rzl-golden-*.csv` (AUT-521); no inline string expectations. |
| 0% handling decided and recorded | Section "Zero-rate (0%) decision". Tested in `accounting-export-candidates.rzl.spec.ts` and `accounting-export-allocation-rules.spec.ts`. |
| Totals reconcile per Steuercode against the frozen facts | `rzl-sample-export.spec.ts`: gross per Steuercode from the file equals net plus tax from the frozen rows. |
| Re-download returns identical bytes; same authorization as DATEV | Storage and download path unchanged from DATEV. E2E coverage: see the PR description. |
| OpenAPI and generated types regenerated | `apps/core-api/openapi/openapi.json` and `apps/core-web/src/api/generated/openapi.ts`, regenerated from the code. |
| Migrations expand-only | No migration. |
| Tenant isolation lint passes | `npm run lint:prisma-tenant --workspace=core-api` (see the PR description for the result). |
| Profile not enabled for production; no pilot import claimed | Flag default off. Fixtures use synthetic pilot-customer labels only. No live RZL import attempted in AUT-521. |

## Acceptance mapping (AUT-521)

| Criterion | Evidence |
|---|---|
| Public RZL sources mapped to K/C/B draft, encoding, OP/firm/tax keys | This document: "Sources consulted", "Source matrix". `RZL_FIBU_EURO_PUBLIC_FIELD_NAMES`, reference fixtures. |
| Synthetic vs evidenced vs tried separated | Fixtures table; handbook line parsed without serializer; pilot CSV is draft-layout only. |
| Synthetic mixed invoice / partial credit bytes | `fixtures/rzl-golden-*.csv`; `rzl-fibu-import.golden.spec.ts`. |
| Handbook §2.3 amounts in ACP draft bytes | `fixtures/rzl-draft-evidenced-export.csv`, `rzl-draft-evidenced.fixture.ts`. |
| Replay/hash regression; live profile does not alter completed export | Generic export immutability; `accounting-export-rzl.e2e-spec.ts` RZ-03, RZ-05. |
| Default-off gate and business exclusions unchanged | No change to release env or candidate rules; blocker golden JSON in AUT-521. |
| Tests bind serializer output, not mirrored assertions | Golden tests compare `result.bytes` to committed files. |
| No vendor acceptance claimed | Blocker tests and spec disclaimers. |

## Assumptions [UNVERIFIED]

ACP draft file choices not confirmed by a live RZL import.

| ID | Assumption | Status after AUT-521 | Basis |
|---|---|---|---|
| A1 | K/C/B records instead of flat 41-column Euro-Version rows. | **Still unverified** | Entire ACP draft shape. S1 describes flat rows only. |
| A2 | Header carries firm number, UTC timestamp, period, chart, account length. | **Still unverified** | Not in S1 booking columns. |
| A3 | `BUCHUNGSART` `AR` / `AG` on booking lines. | **Still unverified** | S1: `Belegkreis` `AR` + numeric `Buchungsart` on examples. |
| A4 | Credits use `AG` and positive `H` amounts. | **Still unverified** | S1 Gutschrift example: `AR`, Haben/Soll split, negative tax. |
| A5 | CRLF with trailing CRLF on the draft file. | **Evidenced (file format)** | S1 §1.2.1 for import files generally. |
| A6 | `DD.MM.YYYY` dates in the draft file. | **Still unverified** | S1: `TTMMJJJJ` on `Beleg-Datum`. |
| A7 | Quoted alphanumeric `BELEGNUMMER`. | **Still unverified** | S1 examples vary. |
| A8 | Single unsigned `BETRAG` + `S`/`H` instead of Soll/Haben columns. | **Still unverified** | S1 amount model differs. |
| A9 | One `STEUERCODE` per line from profile. | **Still unverified** | S1: `USt-Schlüssel` + `USt-Code`. |
| A10 | Booking text up to 60 characters. | **Still unverified** | S1: 40 per line. |
| A11 | `OP_BELEGNUMMER` equals document or original invoice number. | **Partial** | S1 requires OP on personenkonto lines; semantics differ. |
| A12 | `OP_MODUS` `E` / `M`. | **Still unverified** | Not in S1 column list. |
| A13 | One booking line per allocation with unsigned gross on `KONTO`/`GEGENKONTO`. | **Still unverified** | S1 examples use two import lines (debtor gross, then revenue net + tax). |

## Open items: RZL import validation (human, not AUT-521)

**AUT-361 / AUT-368 remain cancelled** as engineering blockers. Before any production enablement, a human should still:

1. Import the ACP draft file (or a future S1-aligned export) into a non-production RZL client and compare totals per tax key with frozen facts.
2. Decide whether the draft K/C/B shape is acceptable or the export must be rebuilt to the 41-column Euro-Version (and whether a Listenform is required).
3. Confirm Steuercodes / `USt-Schlüssel` mapping with the accountant and whether 0% needs a approved code.
4. Confirm open-item and due-date requirements with the accountant.

## References

- [[datev-accounting-export]], [[legal-invoicing-and-credit-notes]], [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]].
- Source: `apps/core-api/src/finance/accounting-export/rzl-fibu-import.serializer.ts`, `rzl-format.constants.ts`, `accounting-export-allocation-rules.ts`, `accounting-export-candidates.ts`; `apps/core-api/src/finance/accounting-profile/accounting-profile-export-readiness.ts`, `accounting-profile.serializer-params.ts`.
- Tests: `rzl-fibu-import.golden.spec.ts`, `rzl-fibu-import.serializer.spec.ts`, `rzl-sample-export.spec.ts`, `accounting-export-candidates.rzl.spec.ts`, `accounting-export-allocation-rules.spec.ts`, `accounting-profile-export-readiness.spec.ts`.
