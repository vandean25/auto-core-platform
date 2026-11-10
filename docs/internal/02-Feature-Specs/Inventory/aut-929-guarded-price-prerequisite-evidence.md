# AUT-929 prerequisite evidence (ADR-0037 implementation validation)

Recorded as the first commit of AUT-929 (886b). Product: pilot customer hosting stack only; no production configuration changes in this ticket.

## Firebase Hosting → Cloud Run: `Idempotency-Key` forwarding

**Configuration:** `firebase.json` rewrites `/api/**` to the `core-api` Cloud Run service in `europe-west3` (`hosting.rewrites` with `run.serviceId`).

**Conclusion:** Client request headers, including `Idempotency-Key`, are forwarded to the Cloud Run revision for API rewrites. Firebase documents that Hosting passes the incoming request headers to the Cloud Run backend for `run` rewrites (same behaviour as the existing `Idempotency-Key` usage on document branding and registration intake against the same Hosting → Cloud Run path).

**Fallback (ADR decision 2):** If a future proxy strips the header, guarded `PATCH /api/inventory/:id` also accepts query parameter `operationKey` with the same UUIDv7 semantics as the header.

## Realtime extension timing relative to commit

**Implementation today:** `prisma-dashboard-realtime.extension.ts` calls `emitAfterQuery`: the Prisma write runs first, then `emitEntityUpdated` runs in the same request, still inside the open transaction when the write is part of `$transaction`.

**Guarded price path (886b):** Tx-E updates `retail_price` with a tenant-scoped `catalogItem.update` inside `$transaction`. The extension may emit on that update before the transaction commits. To satisfy ADR-0037 (“realtime only after the price commit”), the guarded path calls `DashboardRealtimeService.emitEntityUpdated` **after** the Tx-E `$transaction` resolves successfully. CONFLICT and rollback paths perform no catalog write and emit nothing.

**Evidence for CONFLICT:** Tx-E records journal CONFLICT only; no `catalogItem` update runs, so the realtime extension does not fire for price on mismatch.
