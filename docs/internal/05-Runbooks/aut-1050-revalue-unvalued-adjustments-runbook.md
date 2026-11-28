# Runbook: Revalue legacy unvalued stock corrections (AUT-1050, nachbewertet)

## Purpose
Values manual stock corrections booked before AUT-1048 without a unit cost (`inventory_transactions.type = ADJUSTMENT`, `reference_id = 'manual-adjustment'`, `cost_basis = null`). Each original gets a Gegenbuchung plus a new valued `ADJUSTMENT`, both dated at run time and noted `nachbewertet`. The original row is never updated. Rules: [Inventory & Catalog spec](../02-Feature-Specs/Inventory/inventory-and-catalog.md#legacy-unvalued-corrections-aut-1050-nachbewertet).

## Execution rules
- **QA:** allowed, on QA seed and test data only.
- **Production:** requires **Dejan's explicit OK** before any call with `"dryRun": false`. Not part of merging AUT-1050.
- **No job:** there is no Cloud Run job, Cloud Scheduler entry or cron. The command runs only when an admin calls it.
- **Coding agents:** never call it against production.

## Usage (QA)
Signed in as OWNER or ADMIN of the tenant (bearer token of that session). The command covers the tenant's sites the caller is a member of.

1. Dry run (books nothing):
   ```bash
   curl -sS -X POST "$QA_API/api/inventory/revalue-unvalued-adjustments" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"dryRun": true}'
   ```
2. Check the report: `revalued` (what would be booked, with `unitCost` and `valueSource`), `gaps` (no average and no last EK).
3. Apply with `"dryRun": false`.
4. Run the dry run again: `revalued` must be empty and every applied original must be listed in `alreadyRevalued`.

## Report
```json
{
  "dryRun": false,
  "batchSize": 100,
  "revalued": [
    {
      "originalTransactionId": "…",
      "itemId": "…",
      "locationId": "…",
      "quantity": "1",
      "unitCost": "4.5",
      "valueSource": "AVG",
      "reversalTransactionId": "…",
      "revaluedTransactionId": "…"
    }
  ],
  "gaps": [{ "originalTransactionId": "…", "itemId": "…", "locationId": "…" }],
  "alreadyRevalued": ["…"],
  "alreadyReversed": ["…"]
}
```
`reversalTransactionId` and `revaluedTransactionId` are `null` in a dry run.

## Gaps
A gap article has no `InventoryValuation` average, no same-legal-entity `PURCHASE_RECEIPT` cost, no `CatalogItem.cost_price` and no `VendorArticle.last_cost`. Nothing is booked for it. Maintain a cost price or book a receipt, then run again.

## Failure and rerun
Originals are processed in batches of up to 100, one database transaction per batch; one article's originals always stay in the same batch (an article with more than 100 gets its own). Inside a batch every Gegenbuchung is booked first, then the valued inbounds, then the valued outbounds. A batch locks its articles' valuation rows before it reads any cost, so stock bookings for those articles (receipts, sales, workshop consumption) wait until the batch commits; run it outside working hours. A location whose on-hand is already negative fails its batch with "Insufficient Stock" even though the pair nets to 0, and the other originals of that batch roll back with it; correct that stock first, then run again. Cost lookups run one article at a time inside the 60 s batch transaction; on a very large tenant a batch can time out and roll back. Run again after the cause is clear. If a statement fails, its whole batch rolls back (no partial pair, originals untouched) and the call returns an error. Batches committed before the failure stay complete. Fix the cause and run again; completed originals are skipped.

## Verification queries (QA)
```sql
-- Pairs written by the revaluation
SELECT id, reversal_of_transaction_id, quantity, cost_basis, value_source, "createdAt"
FROM inventory_transactions
WHERE tenant_id = '<TENANT_UUID>' AND note = 'nachbewertet'
ORDER BY seq;

-- Remaining unvalued originals (should only be gaps)
SELECT t.id FROM inventory_transactions t
WHERE t.tenant_id = '<TENANT_UUID>' AND t.type = 'ADJUSTMENT'
  AND t.reference_id = 'manual-adjustment' AND t.cost_basis IS NULL
  AND t.reversal_of_transaction_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_transactions r WHERE r.reversal_of_transaction_id = t.id);
```
