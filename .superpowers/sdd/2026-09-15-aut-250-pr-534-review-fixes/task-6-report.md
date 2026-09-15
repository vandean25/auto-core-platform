# Task 6 report — PR #534 service review fixes

## Status

Implemented the approved Task 6 checklist directly in the existing isolated worktree on `kilo/cosmic-creek-r0e`, starting from `c9da64a2`. No subagents or reviewers were dispatched.

## Completed checklist

- [x] Both initial and conflict-recovery command lookups use `findFirst` with explicit `tenant_id`, `transfer_id`, `action`, and `idempotency_key` predicates.
- [x] Initial replay and conflict recovery authorize membership on either transfer endpoint before reading command state or comparing request hashes. Outsiders receive 404 for matching, mismatching, and missing commands. Authorized hash mismatches remain 409; stored response replay and destination-only source-bin redaction remain intact.
- [x] All seven mutation paths emit through a shared helper after `$transaction` resolves. Failed commits emit nothing; receive/return store their durable command response inside the transaction.
- [x] Number allocation increments the tenant-wide sequence atomically and uses the prefix returned by that update. Existing custom, prior-year, and empty prefixes are preserved; the default prefix is only supplied when settings are created.
- [x] Ship ledger construction reuses loaded transfer lines and fetches distinct catalog item costs once. Settlement fetches historical ship costs once, scoped by tenant, source site, transfer, and item/source-bin pairs. Maps retain the earliest ship movement, including zero and null costs.
- [x] Ship/receive/return line writes use `chunkedPromiseAll` inside the transaction, retaining per-line optimistic guards and conflict handling. Sorted site/stock locking and paired ledger writes remain in place.
- [x] Focused regression tests cover authorization/disclosure, tenant query shape, all mutation commit boundaries, prefix preservation, multiline cost mapping/query counts, concurrent dispatch, and guarded line conflicts.

## TDD evidence

- Baseline: stock-transfer service suite passed 41 tests before edits.
- First red cycle: 24 authorization/tenant lookup/commit-boundary cases failed against the original service; after correcting a test fixture, all 3 prefix cases also failed with the hardcoded `TR-2026-` value.
- First green cycle: 68 stock-transfer tests passed after the authorization, commit-boundary, and numbering fixes.
- Second red cycle: 6 multiline cases failed because reads were per-line and guarded updates dispatched serially. Three existing conflict-behavior checks passed as preservation coverage.
- Second green cycle: all 77 stock-transfer tests passed.

## Verification

- `npm test --workspace=core-api -- --ci --runInBand`: 190 suites, 1,719 tests passed (73.094 seconds).
- `npm test --workspace=core-api -- --runInBand stock-transfer.service.spec.ts`: 77 passed.
- `npm test --workspace=core-api -- --ci --runInBand stock-transfer.service.spec.ts tenant-isolation.extension.spec.ts ledger.service.spec.ts location.service.spec.ts invoice-inventory.helpers.spec.ts`: 5 suites, 121 tests passed.
- `npm run build --workspace=core-api`: passed.
- `npx eslint src/stock-transfer/stock-transfer.service.ts src/stock-transfer/stock-transfer.service.spec.ts` (from `apps/core-api`): passed.
- `npm run lint:prisma-tenant --workspace=core-api`: passed.
- Prettier applied to both changed TypeScript files; `git diff --check`: passed.

## Scope and concerns

- Only the service, its spec, and this report are changed. No DTO/controller/schema changes or generated API contract changes are required for Task 6.
- The query-count and commit-boundary tests exercise the real service with mocked database/transport boundaries; they do not establish real PostgreSQL concurrency behavior. Database-backed E2E and the complete PR verification matrix remain with Task 7.
- Realtime emission now occurs after commit; transport/recipient lookup failures can therefore occur after persistence. Durable event delivery/outbox behavior is outside this task.
- Local tests emit the existing missing-`FRONTEND_URL` development CORS warning.
- The TypeScript clean-code guidance led to a shared commit/emission boundary, removal of the per-line cost helper, and parameter objects for the ledger helpers.
