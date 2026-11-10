/**
 * AUT-928 / ADR-0037 A2: inventoried writers of `catalog_items`.
 * The guard test `catalog-item-revision-writers.spec.ts` must stay in sync with this list.
 *
 * Evidence summary (2026-11-09):
 * - Application Prisma writers (below); no raw `UPDATE catalog_items` in `apps/core-api/src`.
 * - Seeds/jobs: `prisma/fixtures/inventory.fixture.ts` (upsert/update); `clean-db.ts` (deleteMany).
 * - Imports: supplier price list apply (create/update); import undo (updateMany + deleteMany recreate path).
 * - Workshop JIT catalog line: `updateMany` + `create`.
 * - E2E/tests create parts directly via Prisma (not request-time writers).
 * - Existing DB triggers on `catalog_items`: none before AUT-928 migration.
 * - Prisma `catalogItem.update` RETURNING: validated in `catalog-item-revision.e2e-spec.ts`.
 */
export const REGISTERED_CATALOG_ITEM_WRITER_PATHS = [
  'import/import-undo-writer.ts',
  'import/import-undo.service.ts',
  'import/supplier-price-list-import.apply.ts',
  'inventory/guarded-price/guarded-price.service.ts',
  'inventory/inventory-item-mutations.service.ts',
  'inventory/inventory.service.ts',
  'prisma/fixtures/clean-db.ts',
  'prisma/fixtures/inventory.fixture.ts',
  'workshop/workshop-catalog-line.service.ts',
] as const;
