import { ImportRowAction, type Prisma } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { ApplyRowStaleError } from './import-apply.errors.js';
import { createApplyTotals, tallyWrittenRow } from './import-totals.util.js';
import type { ImportApplyRow } from './import-type-handler.js';
import type { ImportJobTotals } from './import.types.js';

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
  const { description, unit, ean, brandId } = parseCreateFields(
    payload,
    articleNo,
  );

  const createdItem = await tx.catalogItem.create({
    data: {
      tenant_id: ctx.tenantId,
      sku: articleNo,
      name: description,
      cost_price: prices.newCost,
      retail_price: prices.newRetail,
      unit,
      brand_id: brandId,
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

type ParsedChunkUpdate = {
  kind: 'update';
  entityId: string;
  payload: Record<string, unknown>;
  articleNo: string;
  prices: SupplierPrices;
};

type ParsedChunkCreate = {
  kind: 'create';
  rowNo: number;
  articleNo: string;
  prices: SupplierPrices;
  description: string;
  unit: string;
  brandId: number | null;
  ean: string | null;
};

type ParsedSupplierChunk = {
  counts: ImportJobTotals;
  operations: Array<ParsedChunkUpdate | ParsedChunkCreate>;
  updates: ParsedChunkUpdate[];
  creates: ParsedChunkCreate[];
};

function parseCreateFields(
  payload: Record<string, unknown>,
  articleNo: string,
) {
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
  const brandId = payload.brand_id != null ? Number(payload.brand_id) : null;
  return { description, unit, ean, brandId };
}

function parseSupplierChunkRows(chunk: ImportApplyRow[]): ParsedSupplierChunk {
  const counts = createApplyTotals(0);
  const operations: Array<ParsedChunkUpdate | ParsedChunkCreate> = [];
  const updates: ParsedChunkUpdate[] = [];
  const creates: ParsedChunkCreate[] = [];

  for (const row of chunk) {
    if (row.action === ImportRowAction.ERROR) {
      counts.error += 1;
      continue;
    }
    if (row.action === ImportRowAction.SKIP) {
      counts.skip += 1;
      continue;
    }
    const payload = (row.normalized_json ?? {}) as Record<string, unknown>;
    const articleNo = resolveSupplierArticleNo(payload, row.external_id);
    const prices = readSupplierPrices(payload);
    if (row.action === ImportRowAction.UPDATE) {
      if (!row.entity_id) {
        throw new ApplyRowStaleError('Artikel-ID fehlt');
      }
      const entry: ParsedChunkUpdate = {
        kind: 'update',
        entityId: row.entity_id,
        payload,
        articleNo,
        prices,
      };
      operations.push(entry);
      updates.push(entry);
      counts.update += 1;
    } else if (row.action === ImportRowAction.CREATE) {
      const fields = parseCreateFields(payload, articleNo);
      const entry: ParsedChunkCreate = {
        kind: 'create',
        rowNo: row.row_no,
        articleNo,
        prices,
        ...fields,
      };
      operations.push(entry);
      creates.push(entry);
      counts.create += 1;
    } else {
      tallyWrittenRow(counts, row.action);
    }
  }
  return { counts, operations, updates, creates };
}

async function loadSupplierChunkLookups(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  updates: ParsedChunkUpdate[],
  creates: ParsedChunkCreate[],
) {
  const entityIds = [...new Set(updates.map((u) => u.entityId))];
  const existingItems =
    entityIds.length > 0
      ? await tx.catalogItem.findMany({
          where: { tenant_id: ctx.tenantId, id: { in: entityIds } },
          select: { id: true, cost_price: true, retail_price: true },
        })
      : [];
  const itemById = new Map<string, CatalogPriceFields>(
    existingItems.map((item) => [item.id, { ...item }]),
  );
  for (const entry of updates) {
    const item = itemById.get(entry.entityId);
    if (!item) {
      throw new ApplyRowStaleError('Artikel wurde zwischenzeitlich gelöscht');
    }
    assertCatalogPricesUnchanged(item, entry.payload, entry.prices);
  }

  const uniqueArticleNos = [
    ...new Set([...updates, ...creates].map((op) => op.articleNo)),
  ];
  const existingVendorArticles =
    uniqueArticleNos.length > 0
      ? await tx.vendorArticle.findMany({
          where: {
            tenant_id: ctx.tenantId,
            vendor_id: ctx.vendorId,
            OR: uniqueArticleNos.map((articleNo) => ({
              vendor_article_no: { equals: articleNo, mode: 'insensitive' },
            })),
          },
          select: { vendor_article_no: true },
        })
      : [];
  const vendorArticleByLowerNo = new Map<string, string>(
    existingVendorArticles.map((m) => [
      m.vendor_article_no.toLowerCase(),
      m.vendor_article_no,
    ]),
  );
  return { itemById, vendorArticleByLowerNo };
}

async function createSupplierChunkItems(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  creates: ParsedChunkCreate[],
): Promise<Map<string, string>> {
  if (creates.length === 0) {
    return new Map();
  }
  const createdItems = await tx.catalogItem.createManyAndReturn({
    data: creates.map((entry) => ({
      tenant_id: ctx.tenantId,
      sku: entry.articleNo,
      name: entry.description,
      cost_price: entry.prices.newCost,
      retail_price: entry.prices.newRetail,
      unit: entry.unit,
      brand_id: entry.brandId,
      ean: entry.ean,
      source_system: ctx.sourceSystem,
    })),
    select: { id: true, sku: true },
  });
  const createdIdBySku = new Map(createdItems.map((c) => [c.sku, c.id]));
  await chunkedPromiseAll(creates, (entry) =>
    tx.importJobRow.update({
      where: {
        tenant_id_import_job_id_row_no: {
          tenant_id: ctx.tenantId,
          import_job_id: ctx.jobId,
          row_no: entry.rowNo,
        },
      },
      data: { entity_id: createdIdBySku.get(entry.articleNo)! },
    }),
  );
  return createdIdBySku;
}

type VendorArticleWrite = {
  tenant_id: string;
  vendor_id: string;
  catalog_item_id: string;
  vendor_article_no: string;
  last_cost: number;
  last_rrp: number | null;
};

function queueVendorArticleWrite(
  vendorArticleByLowerNo: Map<string, string>,
  pendingCreatesByLowerNo: Map<string, VendorArticleWrite>,
  updatesByArtNo: Map<string, VendorArticleWrite>,
  ctx: SupplierApplyContext,
  catalogItemId: string,
  articleNo: string,
  prices: SupplierPrices,
) {
  const lower = articleNo.toLowerCase();
  const existingArtNo = vendorArticleByLowerNo.get(lower);
  if (existingArtNo) {
    updatesByArtNo.set(existingArtNo, {
      tenant_id: ctx.tenantId,
      vendor_id: ctx.vendorId,
      catalog_item_id: catalogItemId,
      vendor_article_no: existingArtNo,
      last_cost: prices.newCost,
      last_rrp: prices.rrp,
    });
    return;
  }
  pendingCreatesByLowerNo.set(lower, {
    tenant_id: ctx.tenantId,
    vendor_id: ctx.vendorId,
    catalog_item_id: catalogItemId,
    vendor_article_no: articleNo,
    last_cost: prices.newCost,
    last_rrp: prices.rrp,
  });
}

function buildSupplierChunkWrites(
  ctx: SupplierApplyContext,
  parsed: ParsedSupplierChunk,
  itemById: Map<string, CatalogPriceFields>,
  vendorArticleByLowerNo: Map<string, string>,
  createdIdBySku: Map<string, string>,
) {
  const catalogUpdatesById = new Map<
    string,
    { id: string; newCost: number; newRetail: number }
  >();
  const priceHistoryCreates: Prisma.CatalogPriceHistoryCreateManyInput[] = [];
  const pendingVendorCreates = new Map<string, VendorArticleWrite>();
  const vendorUpdatesByArtNo = new Map<string, VendorArticleWrite>();

  for (const op of parsed.operations) {
    if (op.kind === 'create') {
      const itemId = createdIdBySku.get(op.articleNo)!;
      priceHistoryCreates.push({
        tenant_id: ctx.tenantId,
        catalog_item_id: itemId,
        old_cost: null,
        new_cost: op.prices.newCost,
        old_retail: null,
        new_retail: op.prices.newRetail,
        import_job_id: ctx.jobId,
      });
      queueVendorArticleWrite(
        vendorArticleByLowerNo,
        pendingVendorCreates,
        vendorUpdatesByArtNo,
        ctx,
        itemId,
        op.articleNo,
        op.prices,
      );
      continue;
    }

    const item = itemById.get(op.entityId)!;
    const currentCost = currentCostOf(item);
    const currentRetail = Number(item.retail_price);
    const costChanged =
      currentCost === null ||
      Math.abs(op.prices.newCost - currentCost) >= PRICE_EPSILON;
    const retailChanged =
      Math.abs(op.prices.newRetail - currentRetail) >= PRICE_EPSILON;
    if (costChanged || retailChanged) {
      catalogUpdatesById.set(item.id, {
        id: item.id,
        newCost: op.prices.newCost,
        newRetail: op.prices.newRetail,
      });
      priceHistoryCreates.push({
        tenant_id: ctx.tenantId,
        catalog_item_id: item.id,
        old_cost: currentCost,
        new_cost: op.prices.newCost,
        old_retail: currentRetail,
        new_retail: op.prices.newRetail,
        import_job_id: ctx.jobId,
      });
      item.cost_price = op.prices.newCost;
      item.retail_price = op.prices.newRetail;
    }
    queueVendorArticleWrite(
      vendorArticleByLowerNo,
      pendingVendorCreates,
      vendorUpdatesByArtNo,
      ctx,
      item.id,
      op.articleNo,
      op.prices,
    );
  }

  return {
    catalogUpdates: [...catalogUpdatesById.values()],
    priceHistoryCreates,
    vendorCreates: [...pendingVendorCreates.values()],
    vendorUpdates: [...vendorUpdatesByArtNo.values()],
  };
}

/**
 * Applies a chunk of planned supplier rows inside one transaction using batched
 * findMany / createManyAndReturn / createMany and bounded-concurrency updates.
 */
export async function applySupplierImportChunk(
  tx: Prisma.TransactionClient,
  ctx: SupplierApplyContext,
  chunk: ImportApplyRow[],
): Promise<ImportJobTotals> {
  const parsed = parseSupplierChunkRows(chunk);
  if (parsed.updates.length === 0 && parsed.creates.length === 0) {
    return parsed.counts;
  }

  const { itemById, vendorArticleByLowerNo } = await loadSupplierChunkLookups(
    tx,
    ctx,
    parsed.updates,
    parsed.creates,
  );
  const createdIdBySku = await createSupplierChunkItems(
    tx,
    ctx,
    parsed.creates,
  );
  const writes = buildSupplierChunkWrites(
    ctx,
    parsed,
    itemById,
    vendorArticleByLowerNo,
    createdIdBySku,
  );

  if (writes.catalogUpdates.length > 0) {
    await chunkedPromiseAll(writes.catalogUpdates, (u) =>
      tx.catalogItem.update({
        where: { id: u.id },
        data: { cost_price: u.newCost, retail_price: u.newRetail },
      }),
    );
  }
  if (writes.priceHistoryCreates.length > 0) {
    await tx.catalogPriceHistory.createMany({
      data: writes.priceHistoryCreates,
    });
  }
  if (writes.vendorCreates.length > 0) {
    await tx.vendorArticle.createMany({ data: writes.vendorCreates });
  }
  if (writes.vendorUpdates.length > 0) {
    await chunkedPromiseAll(writes.vendorUpdates, (u) =>
      tx.vendorArticle.update({
        where: {
          tenant_id_vendor_id_vendor_article_no: {
            tenant_id: u.tenant_id,
            vendor_id: u.vendor_id,
            vendor_article_no: u.vendor_article_no,
          },
        },
        data: {
          catalog_item_id: u.catalog_item_id,
          last_cost: u.last_cost,
          last_rrp: u.last_rrp,
        },
      }),
    );
  }
  return parsed.counts;
}
