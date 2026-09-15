# Task 3 Report: Exclude in-transit stock from sales invoice allocation

## Scope

Implemented only Task 3 from the approved PR #534 review-fix plan. Sales invoice inventory allocation now excludes both staging totes and in-transit locations.

## Changes

- Updated `apps/core-api/src/sales/helpers/invoice-inventory.helpers.spec.ts` so the focused query expectation requires:

  `type: { notIn: [LocationType.staging_tote, LocationType.in_transit] }`

- Updated `apps/core-api/src/sales/helpers/invoice-inventory.helpers.ts` with the same exact Prisma location filter.

## TDD Evidence

1. Changed the focused helper expectation first.
2. Ran the focused spec before the production change. It failed as expected because production still returned `type: { not: LocationType.staging_tote }`.
3. Applied the minimal production filter change.
4. Re-ran the focused spec successfully.

## Verification

Command:

```text
npm test --workspace=core-api -- --runInBand src/sales/helpers/invoice-inventory.helpers.spec.ts
```

Result: 1 test suite passed; 7 tests passed.

Additional check:

```text
git diff --check
```

Result: clean.

## Self-review

- The change is limited to the two required helper files.
- The filter uses the exact required `notIn` values and enum members.
- Existing tenant and active-site scoping remains unchanged.
- No unrelated cleanup or contract changes were made.

## Concerns

None identified within Task 3 scope.

## Round 1 Review Fix

Strengthened the focused helper test after review feedback:

- Renamed the test to explicitly mention staging totes and in-transit locations.
- Added representative eligible, staging-tote, and in-transit stock candidates.
- Made the mocked candidate query emulate Prisma filtering based on the requested location predicate, so the old staging-only predicate lets the in-transit candidate reach allocation.
- Asserted that only the eligible stock reaches `deductOnHandForSale`.
- Preserved the exact query-shape assertion for `notIn: [LocationType.staging_tote, LocationType.in_transit]`.

## Round 1 TDD Evidence

With the old production predicate (`type: { not: LocationType.staging_tote }`), the focused spec failed because `stock-in-transit` reached `deductOnHandForSale` instead of `stock-eligible`.

After restoring the existing exact `notIn` production filter, the focused spec passed:

```text
npm test --workspace=core-api -- --runInBand src/sales/helpers/invoice-inventory.helpers.spec.ts
```

Result: 1 test suite passed; 7 tests passed. `git diff --check` also passed.

## Final Fix Round

Renamed the focused helper test title to `excludes staging totes and in-transit locations from stock selection`, with no production or assertion changes.

Verification:

```text
npm test --workspace=core-api -- --runInBand src/sales/helpers/invoice-inventory.helpers.spec.ts
```

Result: 1 test suite passed; 7 tests passed.
