# RZL sample export (AUT-350)

`rzl-sample-export.csv` is generated from `rzl-sample-export.fixture.ts` by the RZL serializer (`../rzl-fibu-import.serializer.ts`). `rzl-sample-export.spec.ts` fails if the committed bytes drift from the serializer output.

**Not validated against RZL.** This file shows the ACP draft layout `RZL-FIBU-IMPORT-ACP-DRAFT-1`. It was not imported into any RZL product and has not been checked against the official RZL FIBU import specification, which could not be retrieved while this was written. Real validation is **AUT-368**, a human step with an accountant and a test import.

The accounts (2000 debtor, 8200/8300/8400 revenue) and the firm number `FN-4711` are fixture values, not production defaults. Do not enable the RZL profile for any production tenant until AUT-368 passes; the platform release flag `ACCOUNTING_EXPORT_RZL_SERIALIZER_ENABLED` stays `false` until then.

To regenerate after an intended layout change, run the serializer on the fixture and update the pinned SHA-256 in `rzl-sample-export.spec.ts` in the same commit.

# BMD sample export (AUT-351)

`bmd-sample-export.csv` is a **hand-authored synthetic sample**, written from the record layout in `docs/internal/02-Feature-Specs/Finance/bmd-accounting-export.md` before the BMD serializer existed. The serializer must reproduce these bytes exactly; `bmd-ntcs-import.golden.spec.ts` fails if they drift.

**Not validated against BMD.** The layout `BMD-NTCS-ASCII-IMPORT-ACP-DRAFT-1` is ACP's best-effort reading. No BMD documentation was retrieved, so every layout detail is listed as an assumption (A1 to A15) in the spec. Validation against BMD NTCS is an open item for the owner; no issue ID is assumed here.

The accounts (2000 debtor, 8200/8300/8400 revenue) and the tax keys (5010/5013/5020) are fixture values, not production defaults. The platform release flag `ACCOUNTING_EXPORT_BMD_SERIALIZER_ENABLED` stays `false`, and no tenant enables the BMD profile.
