---
title: "RZL Accounting Export (ACP-RZL-AT-EUR-1)"
date: "2026-10-12"
module: "Finance"
status: implementation-draft
linear-issue: "https://linear.app/auto-core-platform/issue/AUT-350"
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
tags: [feature-spec, finance, accounting, export, austria]
---

# RZL Accounting Export (ACP-RZL-AT-EUR-1)

## Summary

AT legal entities export a closed period of STANDARD-VAT invoices and credit notes as an RZL FIBU import CSV. The file is built only from the frozen accounting allocation of each committed line, never from live revenue groups. This spec covers AUT-350 steps 2 to 5: pinned specification, serializer, per-entity profile configuration with a settings UI, and a release gate that keeps the profile disabled.

It depends on [[datev-accounting-export]] (run, replay and authorization model), [[legal-invoicing-and-credit-notes]], and [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]]. It follows ADR-0023's rule that a supported PDF does not imply a supported accounting export.

**Status: implementation draft.** The layout is ACP's own pinned reading of the RZL format. It is not certified against RZL. Real validation is **AUT-368** (human, with the accountant and an RZL installation). Until AUT-368 passes, the platform flag stays off and no production tenant enables the profile.

## Scope

Must-have: serializer registered in the existing export serializer registry; profile fields for firm number and Steuercodes per legal entity; export-only readiness gaps; settings UI; generation blocked unless the release flag is on; committed sample export with golden tests.

Out of scope: real RZL import validation (AUT-368); enabling the profile for any tenant; margin-scheme postings; exempt, reverse-charge and intra-community treatments; BMD (AUT-351); the margin snapshot work (AUT-349); the lift of the export block (AUT-369); purchases, payments and general-ledger balancing.

## Pinned specification

| Item | Pinned value |
|---|---|
| Source document | RZL FIBU Import Schnittstelle, https://rzlsoftware.at/fileadmin/user_upload/PDF_Schnittstelle/RZL_FIBU_Import_Schnittstelle.pdf |
| Official document version and date | **UNVERIFIED.** The host did not resolve from the build environment on 2026-10-12, so neither the version nor the date could be read. Record the official revision here when AUT-368 obtains it. |
| ACP layout identifier (written into the header record) | `RZL-FIBU-IMPORT-ACP-DRAFT-1`. This is an ACP label. It is not an RZL-published version. |
| Encoding | Windows-1252 (ANSI), no BOM. Characters outside Windows-1252 block the run. |
| Field separator | `;` |
| Text quoting | Text fields are wrapped in double quotes. Embedded `;`, `"`, CR and LF are rejected, not escaped. Leading `=`, `+`, `-` or `@` is rejected (formula safety). |
| Numbers | Amounts use a decimal comma, two places, no thousands separator, unsigned. Credits keep positive amounts and use polarity `H`. |
| Dates | `DD.MM.YYYY` (document and period dates) |
| Creation timestamp | `YYYYMMDDHHmmss` in UTC, frozen at run creation |
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

These codes are ACP's own. The RZL codes have not been verified (AUT-368).

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
| Serializer per public RZL docs; flag default off | ACP draft layout, **not verified against the RZL PDF** (AUT-368). Release gate and fail-closed behavior: `accounting-export-serializer.registry.spec.ts`, `accounting-profile.validation.spec.ts`. |
| Sample export committed, with a note that real validation is AUT-368 | `accounting-export/fixtures/rzl-sample-export.csv` and `fixtures/README.md`; `rzl-sample-export.spec.ts` pins the bytes. |
| DATEV golden tests and bytes unchanged | `datev-serializer.golden.spec.ts` and `datev-serializer.spec.ts` are untouched. The DATEV candidate messages are unchanged (`accounting-export-candidates.rzl.spec.ts`). |
| Golden files for 20%, 13% and 10% invoices and credit notes; positive amounts with opposite polarity; 13% fixture | `rzl-fibu-import.golden.spec.ts`: one pinned file per rate, and a mixed 20/13/10 invoice with a partial 13% credit. |
| 0% handling decided and recorded | Section "Zero-rate (0%) decision". Tested in `accounting-export-candidates.rzl.spec.ts` and `accounting-export-allocation-rules.spec.ts`. |
| Totals reconcile per Steuercode against the frozen facts | `rzl-sample-export.spec.ts`: gross per Steuercode from the file equals net plus tax from the frozen rows. |
| Re-download returns identical bytes; same authorization as DATEV | Storage and download path unchanged from DATEV. E2E coverage: see the PR description. |
| OpenAPI and generated types regenerated | `apps/core-api/openapi/openapi.json` and `apps/core-web/src/api/generated/openapi.ts`, regenerated from the code. |
| Migrations expand-only | No migration. |
| Tenant isolation lint passes | `npm run lint:prisma-tenant --workspace=core-api` (see the PR description for the result). |
| Profile not enabled for production; no pilot import claimed | Flag default off. No tenant data is changed. Real import is AUT-368. |

## Open items for AUT-368

1. Obtain the official RZL FIBU Import specification, record its revision and date here, and confirm field order, separators, record types, date format, encoding and open-item semantics. Replace the ACP identifier if RZL requires its own version string.
2. Confirm the Steuercodes 10, 13 and 20 and what 01, 02 and 03 mean. Confirm whether 0% has an approved code. This decides the zero-rate rule above.
3. Confirm the Buchungsart codes `AR` and `AG`.
4. Run a test import with the accountant's RZL installation. Compare imported gross, net and tax totals per Steuercode with the frozen facts.
5. Decide whether due dates or other fields are needed for open-item handling.

## References

- [[datev-accounting-export]], [[legal-invoicing-and-credit-notes]], [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]].
- Source: `apps/core-api/src/finance/accounting-export/rzl-fibu-import.serializer.ts`, `rzl-format.constants.ts`, `accounting-export-allocation-rules.ts`, `accounting-export-candidates.ts`; `apps/core-api/src/finance/accounting-profile/accounting-profile-export-readiness.ts`, `accounting-profile.serializer-params.ts`.
- Tests: `rzl-fibu-import.golden.spec.ts`, `rzl-fibu-import.serializer.spec.ts`, `rzl-sample-export.spec.ts`, `accounting-export-candidates.rzl.spec.ts`, `accounting-export-allocation-rules.spec.ts`, `accounting-profile-export-readiness.spec.ts`.
