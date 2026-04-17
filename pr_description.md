# ⚡ Optimize SalesService.finalize inventory updates

## 💡 What
The `SalesService.finalize` method was originally executing sequential database queries inside a `for` loop, causing an N+1 issue for both `inventoryStock` updates and `inventoryTransaction` inserts.

This PR applies a hybrid aggregation approach:
- Iterates sequentially through invoice items in memory to accurately assign `location_id` for fulfillment, splitting quantities if needed.
- Aggregates invoice item quantities by a composite key of `${catalog_item_id}_${location_id}` in memory.
- Performs a "Dry-Run" validation to fail fast before issuing database updates.
- Uses `chunkedPromiseAll` to execute the reduced number of `tx.inventoryStock.updateMany` operations concurrently, staying within connection pool limits.
- Batches the 1:1 ledger entries using `tx.inventoryTransaction.createMany` to preserve the granular audit trail while eliminating the N+1 insert queries.

## 🎯 Why
Invoices with many line items (e.g., 100+ items) caused a linear increase in database roundtrips for stock deductions and ledger transactions. This led to high latency, increased lock contention inside the transaction, and potential connection pool exhaustion.

By aggregating in memory and bulk inserting/updating, the number of database queries is drastically reduced to at most N (number of unique catalog items) updates and exactly 1 bulk insert, down from 2 * N total queries.

## 📊 Measured Improvement
⚠️ *Note on Benchmarks: Due to missing environment dependencies (`node_modules` unavailable, restricted network access preventing `npm install`), I was unable to execute the automated jest or ts-node benchmark scripts locally to measure the exact millisecond improvement.*

However, based on the implementation details, this change provides a substantial theoretical performance improvement because:
1. **Network I/O Reduction**: A 100-item invoice with the same catalog item drops from 200 queries inside the transaction loop down to exactly 2 queries (1 update, 1 bulk create).
2. **Locking**: Optimistic locks via `updateMany` are applied per unique item, drastically lowering the lock contention time on the `inventoryStock` rows during large invoice processing.
