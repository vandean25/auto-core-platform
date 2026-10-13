# RZL sample export (AUT-350)

`rzl-sample-export.csv` is generated from `rzl-sample-export.fixture.ts` by the RZL serializer (`../rzl-fibu-import.serializer.ts`). `rzl-sample-export.spec.ts` fails if the committed bytes drift from the serializer output.

**Not validated against RZL.** This file shows the ACP draft layout `RZL-FIBU-IMPORT-ACP-DRAFT-1`. It was not imported into any RZL product and has not been checked against the official RZL FIBU import specification, which could not be retrieved while this was written. Real validation is **AUT-368**, a human step with an accountant and a test import.

The accounts (2000 debtor, 8200/8300/8400 revenue) and the firm number `FN-4711` are fixture values, not production defaults. Do not enable the RZL profile for any production tenant until AUT-368 passes; the platform release flag `ACCOUNTING_EXPORT_RZL_SERIALIZER_ENABLED` stays `false` until then.

To regenerate after an intended layout change, run the serializer on the fixture and update the pinned SHA-256 in `rzl-sample-export.spec.ts` in the same commit.
