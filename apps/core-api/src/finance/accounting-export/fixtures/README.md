# RZL sample export (AUT-350)

`rzl-sample-export.csv` is generated from `rzl-sample-export.fixture.ts` by the RZL serializer (`../rzl-fibu-import.serializer.ts`). `rzl-sample-export.spec.ts` fails if the committed bytes drift from the serializer output.

**Not validated against RZL.** This file shows the ACP draft layout `RZL-FIBU-IMPORT-ACP-DRAFT-1`. It was not imported into any RZL product and has not been checked against the official RZL FIBU import specification, which could not be retrieved while this was written. Real validation is **AUT-368**, a human step with an accountant and a test import.

The accounts (2000 debtor, 8200/8300/8400 revenue) and the firm number `FN-4711` are fixture values, not production defaults. Do not enable the RZL profile for any production tenant until AUT-368 passes; the platform release flag `ACCOUNTING_EXPORT_RZL_SERIALIZER_ENABLED` stays `false` until then.

To regenerate after an intended layout change, run the serializer on the fixture and update the pinned SHA-256 in `rzl-sample-export.spec.ts` in the same commit.

# BMD sample export (AUT-351) — synthetic

`bmd-sample-export.csv` is a **hand-authored synthetic sample**, written from the record layout in `docs/internal/02-Feature-Specs/Finance/bmd-accounting-export.md` before the BMD serializer existed. The serializer must reproduce these bytes exactly; `bmd-ntcs-import.golden.spec.ts` fails if they drift.

**Not validated against BMD.** Golden tests do not claim vendor acceptance. Validation against BMD NTCS remains an open human step for the owner.

The accounts (2000 debtor, 8200/8300/8400 revenue) and the tax keys (5010/5013/5020) are fixture values for a pilot customer, not production defaults. The platform release flag `ACCOUNTING_EXPORT_BMD_SERIALIZER_ENABLED` stays `false`, and no tenant enables the BMD profile.

# BMD MTF format-evidenced export (AUT-520)

`bmd-mtf-evidenced-export.csv` is committed **expected bytes** for the public BMD NTCS Massentransferformat (MTF) column order (source **S3** in the BMD spec). Row facts live in `bmd-mtf-evidenced.fixture.ts` (pilot customer document numbers only). This file is independent of the hand-authored synthetic sample above.

`bmd-mtf-public-header.reference.txt` is the verbatim semicolon-separated header line from source S3. `bmd-ntcs-import.golden.spec.ts` checks that `BMD_MTF_PUBLIC_FIELD_NAMES` stays aligned with that header.

Blocker outcomes for margin scheme and zero-rate VAT are pinned in `bmd-margin-scheme-blockers.golden.json` and `bmd-zero-rate-blockers.golden.json`.
