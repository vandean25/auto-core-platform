import { ImportRowAction, type Prisma } from '@prisma/client';
import { ApplyRowStaleError } from './import-apply.errors.js';
import type { ImportApplyRow } from './import-type-handler.js';

export type SupplierApplyContext = {
  tenantId: string;
  vendorId: string;
  jobId: string;
  sourceSystem: string;
};

type SupplierPrices = {
  newCost: number;
  newRetail: number;
  rrp: number | null;
};

type CatalogPriceFields = {
  id: string;
  cost_price: Prisma.Decimal | number | null;
  retail_price: Prisma.Decimal | number;
};

const PRICE_EPSILON = 0.005;

function currentCostOf(item: CatalogPriceFields): number | null {
  return item.cost_price != null ? Number(item.cost_price) : null;
}

function resolveSupplierArticleNo(
  payload: Record<string, unknown>,
  rowExternalId: string | null,
): string {
  const raw =
    typeof payload.supplier_article_no === 'string'
      ? payload.supplier_article_no
      : typeof rowExternalId === 'string'
        ? rowExternalId
        : '';
  return raw.trim();
}

function readSupplierPrices(payload: Record<string, unknown>): SupplierPrices {
  return {
    newCost: Number(payload.cost_price),
    newRetail: Number(payload.retail_price),
    rrp: payload.rrp != null ? Number(payload.rrp) : null,
  };
}

/** Refuses to overwrite a price that changed in the catalog after the preview was taken. */
function assertCatalogPricesUnchanged(
  item: CatalogPriceFields,
  payload: Record<string, unknown>,
  prices: SupplierPrices,
): void {
  const currentCost = currentCostOf(item);
  const currentRetail = Number(item.retail_price);
  const snapshotOldCost =
    payload.old_cost != null ? Number(payload.old_cost) : null;
  const snapshotOldRetail =
    payload.old_retail != null ? Number(payload.old_retail) : null;

  if (
    snapshotOldCost != null &&
    currentCost != null &&
    Math.abs(currentCost - snapshotOldCost) >= PRICE_EPSILON &&
    Math.abs(currentCost - prices.newCost) >= PRICE_EPSILON
  ) {
    throw new ApplyRowStaleError(
      'Einkaufspreis wurde seit der Vorschau im Katalog geändert',
    );
  }
  if (
    snapshotOldRetail != null &&
    Math.abs(currentRetail - snapshotOldRetail) >= PRICE_EPSILON &&
    Math.abs(currentRetail - prices.newRetail) >= PRICE_EPSILON
  ) {
    throw new ApplyRowStaleError(
      'Verkaufspreis wurde seit der Vorschau im Katalog geändert',
    );
  }
}

/** Writes new prices to the catalog item and a price history row, only when a price moved. */
async function updateCatalogPricesIfChanged(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  item: CatalogPriceFields,
  prices: SupplierPrices,
): Promise<void> {
  const currentCost = currentCostOf(item);
  const currentRetail = Number(item.retail_price);
  const costChanged =
    currentCost === null ||
    Math.abs(prices.newCost - currentCost) >= PRICE_EPSILON;
  const retailChanged =
    Math.abs(prices.newRetail - currentRetail) >= PRICE_EPSILON;
  if (!costChanged && !retailChanged) {
    return;
  }

  await tx.catalogItem.update({
    where: { id: item.id },
    data: { cost_price: prices.newCost, retail_price: prices.newRetail },
  });
  await tx.catalogPriceHistory.create({
    data: {
      tenant_id: ctx.tenantId,
      catalog_item_id: item.id,
      old_cost: currentCost,
      new_cost: prices.newCost,
      old_retail: currentRetail,
      new_retail: prices.newRetail,
      import_job_id: ctx.jobId,
    },
  });
}

/**
 * Points the supplier's article number at a catalog item. An existing mapping is matched
 * case-insensitively and keeps its stored spelling.
 */
async function linkVendorArticle(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  catalogItemId: string,
  articleNo: string,
  prices: SupplierPrices,
): Promise<void> {
  const existingMapping = await tx.vendorArticle.findFirst({
    where: {
      tenant_id: ctx.tenantId,
      vendor_id: ctx.vendorId,
      vendor_article_no: { equals: articleNo, mode: 'insensitive' },
    },
  });
  const effectiveArtNo = existingMapping
    ? existingMapping.vendor_article_no
    : articleNo;

  await tx.vendorArticle.upsert({
    where: {
      tenant_id_vendor_id_vendor_article_no: {
        tenant_id: ctx.tenantId,
        vendor_id: ctx.vendorId,
        vendor_article_no: effectiveArtNo,
      },
    },
    create: {
      tenant_id: ctx.tenantId,
      vendor_id: ctx.vendorId,
      catalog_item_id: catalogItemId,
      vendor_article_no: effectiveArtNo,
      last_cost: prices.newCost,
      last_rrp: prices.rrp,
    },
    update: {
      catalog_item_id: catalogItemId,
      last_cost: prices.newCost,
      last_rrp: prices.rrp,
    },
  });
}

async function updateSupplierArticle(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  row: ImportApplyRow,
  payload: Record<string, unknown>,
  articleNo: string,
  prices: SupplierPrices,
): Promise<{ action: ImportRowAction }> {
  if (!row.entity_id) {
    throw new ApplyRowStaleError('Artikel-ID fehlt');
  }
  const catalogItem = await tx.catalogItem.findFirst({
    where: { tenant_id: ctx.tenantId, id: row.entity_id },
  });
  if (!catalogItem) {
    throw new ApplyRowStaleError('Artikel wurde zwischenzeitlich gelöscht');
  }

  assertCatalogPricesUnchanged(catalogItem, payload, prices);
  await updateCatalogPricesIfChanged(tx, ctx, catalogItem, prices);
  await linkVendorArticle(tx, ctx, catalogItem.id, articleNo, prices);
  return { action: ImportRowAction.UPDATE };
}

async function createSupplierArticle(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  row: ImportApplyRow,
  payload: Record<string, unknown>,
  articleNo: string,
  prices: SupplierPrices,
): Promise<{ action: ImportRowAction }> {
  const description =
    typeof payload.description === 'string'
      ? payload.description.trim()
      : articleNo;
  const unit =
    typeof payload.unit === 'string' && payload.unit.trim()
      ? payload.unit.trim()
      : 'pcs';
  const ean =
    typeof payload.ean === 'string' && payload.ean.trim()
      ? payload.ean.trim()
      : null;

  const createdItem = await tx.catalogItem.create({
    data: {
      tenant_id: ctx.tenantId,
      sku: articleNo,
      name: description,
      cost_price: prices.newCost,
      retail_price: prices.newRetail,
      unit,
      brand_id: payload.brand_id != null ? Number(payload.brand_id) : null,
      ean,
      source_system: ctx.sourceSystem,
    },
  });
  await linkVendorArticle(tx, ctx, createdItem.id, articleNo, prices);
  await tx.catalogPriceHistory.create({
    data: {
      tenant_id: ctx.tenantId,
      catalog_item_id: createdItem.id,
      old_cost: null,
      new_cost: prices.newCost,
      old_retail: null,
      new_retail: prices.newRetail,
      import_job_id: ctx.jobId,
    },
  });
  await tx.importJobRow.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: ctx.tenantId,
        import_job_id: ctx.jobId,
        row_no: row.row_no,
      },
    },
    data: { entity_id: createdItem.id },
  });
  return { action: ImportRowAction.CREATE };
}

/**
 * Writes one planned supplier row inside its transaction. Returns the action that was taken,
 * which the caller uses to count created and updated rows.
 */
export async function applySupplierImportRow(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  row: ImportApplyRow,
): Promise<{ action: ImportRowAction }> {
  const payload = (row.normalized_json ?? {}) as Record<string, unknown>;
  const articleNo = resolveSupplierArticleNo(payload, row.external_id);
  const prices = readSupplierPrices(payload);

  if (row.action === ImportRowAction.UPDATE) {
    return updateSupplierArticle(tx, ctx, row, payload, articleNo, prices);
  }
  if (row.action === ImportRowAction.CREATE) {
    return createSupplierArticle(tx, ctx, row, payload, articleNo, prices);
  }
  return { action: row.action };
}
