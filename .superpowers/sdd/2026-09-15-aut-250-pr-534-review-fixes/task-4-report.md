# Task 4 Report: Block frozen destination-bin deactivation while stock is outstanding

## Scope

Implemented only Task 4 from the approved PR #534 review-fix plan. Location soft deletion now keeps the existing transfer guard tenant-scoped and additionally scopes source and destination references to the active site's persisted transfer endpoints.

## Investigation

- `LocationService.remove` already preserved the existing system-location, child-location, stock, and parked-vehicle deletion rules before checking stock transfers.
- Stock-transfer lines persist `from_site_id` and `to_site_id`, with source locations belonging to the former and frozen destination locations belonging to the latter.
- Receive and return flows define outstanding quantity as `shipped_qty - received_qty - returned_qty`; a destination remains frozen while that value is greater than zero.
- The existing location transfer lookup filtered by `tenant_id` and location ID, but did not constrain the source/destination branches by the active site endpoint.

## Changes

- Added a `LocationService` regression test for deleting a frozen destination bin where `shipped_qty = 5`, `received_qty = 2`, and `returned_qty = 1`.
- The test's database fake exposes the outstanding line only when the destination lookup includes `to_site_id` for the active site, then verifies deletion rejects with `ConflictException`.
- Updated the existing transfer-line lookup so:
  - source references require `from_site_id: scope.siteId`;
  - destination references require `to_site_id: scope.siteId`.
- Left the existing quantity calculation, status filter, conflict message, soft-delete operation, and location/lot deletion checks unchanged.

## TDD Evidence

### Red

Command:

```text
npm test --workspace=core-api -- --runInBand src/inventory/location.service.spec.ts
```

Result before the production change: 1 test failed and 1 passed. The regression test failed for the expected reason: `LocationService.remove` resolved and returned the deleted destination location instead of rejecting because the lookup lacked active destination-site scope.

### Green

Command:

```text
npm test --workspace=core-api -- --runInBand src/inventory/location.service.spec.ts
```

Result after the production change: 1 test suite passed; 2 tests passed.

## Final Verification

Focused location and transfer tests:

```text
npm test --workspace=core-api -- --runInBand src/inventory/location.service.spec.ts src/stock-transfer/stock-transfer.service.spec.ts
```

Result: 2 test suites passed; 43 tests passed; 0 failed.

Full backend unit suite:

```text
npm test --workspace=core-api -- --ci --runInBand
```

Result: 190 test suites passed; 1,683 tests passed; 0 failed.

Touched-file lint:

```text
npm exec --workspace=core-api -- eslint src/inventory/location.service.ts src/inventory/location.service.spec.ts
```

Result: passed with no lint errors or warnings.

## Self-review

- Task scope is limited to the location service, its unit spec, and this report.
- Tenant isolation remains explicit through `tenant_id: scope.tenantId`.
- Site isolation now follows the schema's source/from-site and destination/to-site relationships.
- The regression covers the required strict inequality: `5 > 2 + 1`.
- Existing source-bin outstanding checks and all earlier location/lot deletion guards remain intact and in their original order.
- No controller, DTO, Prisma schema, OpenAPI contract, or deletion-policy change was needed.
- The touched TypeScript uses descriptive names and the existing service structure without unrelated refactoring.

## Concerns

- Focused Jest output includes the existing development CORS fallback warning because `FRONTEND_URL` is unset; it does not affect test results.
- No Task 4 implementation concerns remain.

## Fix Round 1: Serialize location deactivation with stock transfers

### Review finding validation

The concurrency finding was reproducible in the service design. `LocationService.remove` previously ran its location checks, transfer-line check, soft-delete write, and reload as independent Prisma operations. A stock-transfer write could therefore acquire the site lock and freeze a destination after the location service observed no outstanding line but before it set `deletedAt`.

Stock-transfer writes already serialize through tenant-qualified `sites ... FOR UPDATE` locks before changing transfer lines. The matching location operation must acquire that same active-site lock and perform its subsequent checks and write in one transaction so a waiting delete observes the transfer writer's committed line under PostgreSQL `READ COMMITTED` semantics.

### Changes

- Strengthened the existing destination-bin regression test to model a concurrent transfer commit becoming visible only after the location delete waits for the correctly tenant/site-qualified site-row lock.
- The test exercises the public `remove` behavior and expects `ConflictException`; it does not assert private helper calls or lock call counts.
- Wrapped the complete location read/check/write/reload flow in one interactive Prisma transaction.
- Added a tenant/site-qualified `SELECT id FROM "sites" ... ORDER BY id FOR UPDATE` before any deletion checks, matching the stock-transfer site lock order.
- Routed every existing location, child/stock-count, parked-vehicle, transfer-line, update, and reload operation through the transaction client.
- Extracted the existing deletion flow into `softDeleteLocation` so the transaction boundary and lock order remain explicit without adding nested control flow.
- Preserved all existing location/lot deletion rules, exception types/messages, transfer quantity logic, and tenant/site predicates.

### TDD evidence

Red command:

```text
npm test --workspace=core-api -- --runInBand src/inventory/location.service.spec.ts
```

Before the production change, the regression failed with 1 failed and 1 passed test. `remove` resolved to the deleted location because it never waited on the active-site lock or ran through the transaction client, so the concurrent frozen destination line remained invisible to the check.

Green command:

```text
npm test --workspace=core-api -- --runInBand src/inventory/location.service.spec.ts
```

After the production change, the location suite passed with 2/2 tests.

### Fix-round verification

Focused location and stock-transfer suites:

```text
npm test --workspace=core-api -- --runInBand src/inventory/location.service.spec.ts src/stock-transfer/stock-transfer.service.spec.ts
```

Result: 2 suites passed; 43 tests passed; 0 failed.

Full backend unit suite:

```text
npm test --workspace=core-api -- --ci --runInBand
```

Result: 190 suites passed; 1,683 tests passed; 0 failed.

Touched-file lint:

```text
npm exec --workspace=core-api -- eslint src/inventory/location.service.ts src/inventory/location.service.spec.ts
```

Result: passed with no lint errors or warnings.

### Fix-round self-review

- Lock order is site row first, followed by all location dependency reads and the soft-delete write.
- The lock query is constrained by both `tenant_id` and active `site_id`; the transfer-line query retains tenant scope plus `from_site_id`/`to_site_id` endpoint scope.
- Because receive, return, ship, and approval paths use the same site-row lock, location deletion cannot interleave between their transfer mutation and commit.
- The public behavior remains a soft delete returning the reloaded location.
- No controller, DTO, schema, OpenAPI, or deletion-policy contract changed.

### Fix-round concerns

- Focused Jest output still contains the existing `FRONTEND_URL` development fallback warning only.
- No remaining Task 4 concurrency concerns were identified.
