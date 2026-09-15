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
