import { ImportRowAction } from '@prisma/client';
import type { MarginRuleItem } from '../margin-rule/retail-from-cost.util.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { rowToRecord, type ParsedCsv } from './csv-parse.util.js';
import {
  normalizeSupplierPriceListRow,
  planSupplierPriceListDryRunRow,
  type SupplierPriceListCatalogItem,
  type SupplierPriceListMatchContext,
} from './supplier-price-list-import.logic.js';
import { planParsedCsvRowsWithBudget } from './import-dry-run-plan-budget.js';
import type { DryRunRowResult, ImportJobOptions } from './import.types.js';
import type { ImportDryRunPlanBudget } from './import-type-handler.js';

export type SupplierDryRunInput = {
  tenantId: string;
  vendorId: string;
  mapping: Record<string, string>;
  options: ImportJobOptions;
};

type SupplierDryRunData = Awaited<ReturnType<typeof loadSupplierDryRunData>>;
type MarginRuleRecord = SupplierDryRunData[0][number];
type BrandRecord = SupplierDryRunData[1][number];
type FinanceSettingsRecord = SupplierDryRunData[2];
type CatalogItemRecord = SupplierDryRunData[3][number];
type VendorArticleRecord = SupplierDryRunData[4][number];

function toCatalogItemDto(
  item: CatalogItemRecord,
): SupplierPriceListCatalogItem {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    cost_price: item.cost_price != null ? Number(item.cost_price) : null,
    retail_price: Number(item.retail_price),
    ean: item.ean,
    brand_id: item.brand_id,
    revenue_group_id: item.revenue_group_id,
  };
}

async function loadSupplierDryRunData(
  prisma: PrismaService,
  tenantId: string,
  vendorId: string,
) {
  return Promise.all([
    prisma.marginRule.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { priority: 'asc' },
    }),
    prisma.brand.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, name: true, normalized_name: true },
    }),
    prisma.financeSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { price_jump_threshold_percent: true },
    }),
    prisma.catalogItem.findMany({
      where: { tenant_id: tenantId },
      select: {
        id: true,
        sku: true,
        name: true,
        cost_price: true,
        retail_price: true,
        ean: true,
        brand_id: true,
        revenue_group_id: true,
      },
    }),
    prisma.vendorArticle.findMany({
      where: { tenant_id: tenantId, vendor_id: vendorId },
      include: {
        catalog_item: {
          select: {
            id: true,
            sku: true,
            name: true,
            cost_price: true,
            retail_price: true,
            ean: true,
            brand_id: true,
            revenue_group_id: true,
          },
        },
      },
    }),
  ]);
}

function indexCatalogItems(items: CatalogItemRecord[]) {
  const bySku = new Map<string, SupplierPriceListCatalogItem>();
  const byEan = new Map<string, SupplierPriceListCatalogItem>();
  const byId = new Map<string, SupplierPriceListCatalogItem>();
  for (const item of items) {
    const dto = toCatalogItemDto(item);
    byId.set(item.id, dto);
    const sku = item.sku.trim();
    bySku.set(sku, dto);
    bySku.set(sku.toUpperCase(), dto);
    if (item.ean && item.ean.trim().length > 0) {
      byEan.set(item.ean.trim(), dto);
    }
  }
  return { bySku, byEan, byId };
}

function indexVendorArticles(
  articles: VendorArticleRecord[],
  byId: Map<string, SupplierPriceListCatalogItem>,
): Map<string, SupplierPriceListCatalogItem> {
  const byVendorArticleNo = new Map<string, SupplierPriceListCatalogItem>();
  for (const article of articles) {
    const itemDto =
      byId.get(article.catalog_item_id) ??
      (article.catalog_item ? toCatalogItemDto(article.catalog_item) : null);
    if (!itemDto) {
      continue;
    }
    const artNo = article.vendor_article_no.trim();
    byVendorArticleNo.set(artNo, itemDto);
    byVendorArticleNo.set(artNo.toUpperCase(), itemDto);
  }
  return byVendorArticleNo;
}

function indexBrands(
  brands: BrandRecord[],
): Map<string, { id: number; name: string }> {
  const byName = new Map<string, { id: number; name: string }>();
  for (const brand of brands) {
    const entry = { id: brand.id, name: brand.name };
    byName.set(brand.name.trim().toLowerCase(), entry);
    if (brand.normalized_name) {
      byName.set(brand.normalized_name.trim().toLowerCase(), entry);
    }
  }
  return byName;
}

function toMarginRuleItems(rules: MarginRuleRecord[]): MarginRuleItem[] {
  return rules.map((rule) => ({
    id: rule.id,
    priority: rule.priority,
    brand_id: rule.brand_id,
    revenue_group_id: rule.revenue_group_id,
    cost_min: rule.cost_min != null ? Number(rule.cost_min) : null,
    cost_max: rule.cost_max != null ? Number(rule.cost_max) : null,
    markup_percent:
      rule.markup_percent != null ? Number(rule.markup_percent) : null,
    use_supplier_rrp: rule.use_supplier_rrp,
    rounding: rule.rounding,
    is_active: rule.is_active,
  }));
}

/** An explicit threshold on the upload wins, then the tenant's setting, then 20 percent. */
function resolvePriceJumpThreshold(
  financeSettings: FinanceSettingsRecord,
  options: ImportJobOptions,
): number {
  if (options.price_jump_threshold_percent != null) {
    return options.price_jump_threshold_percent;
  }
  return financeSettings?.price_jump_threshold_percent != null
    ? Number(financeSettings.price_jump_threshold_percent)
    : 20;
}

function buildSupplierMatchContext(
  data: SupplierDryRunData,
  options: ImportJobOptions,
): SupplierPriceListMatchContext {
  const [marginRules, brands, financeSettings, catalogItems, vendorArticles] =
    data;
  const catalog = indexCatalogItems(catalogItems);
  return {
    catalogItemByEan: catalog.byEan,
    catalogItemByVendorArticleNo: indexVendorArticles(
      vendorArticles,
      catalog.byId,
    ),
    catalogItemBySku: catalog.bySku,
    catalogItemById: catalog.byId,
    brandByName: indexBrands(brands),
    marginRules: toMarginRuleItems(marginRules),
    priceJumpThresholdPercent: resolvePriceJumpThreshold(
      financeSettings,
      options,
    ),
    articleNoSeenInFile: new Map<string, number>(),
  };
}

function planSupplierCsvRow(
  rowNo: number,
  record: Record<string, string>,
  mapping: Record<string, string>,
  options: ImportJobOptions,
  context: SupplierPriceListMatchContext,
): DryRunRowResult {
  const normalized = normalizeSupplierPriceListRow(record, mapping, options);
  if (!normalized.row) {
    return {
      row_no: rowNo,
      external_id: record[mapping.supplier_article_no ?? ''] ?? null,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: normalized.issues,
      warnings: normalized.warnings,
      normalized: null,
    };
  }
  return planSupplierPriceListDryRunRow(
    rowNo,
    normalized.row,
    context,
    options,
    normalized.warnings,
  );
}

/** Plans every row of a supplier price list against the vendor's catalog and margin rules. */
export async function planSupplierPriceListRows(
  prisma: PrismaService,
  input: SupplierDryRunInput,
  parsed: ParsedCsv,
  planBudget?: ImportDryRunPlanBudget,
): Promise<DryRunRowResult[]> {
  const data = await loadSupplierDryRunData(
    prisma,
    input.tenantId,
    input.vendorId,
  );
  const context = buildSupplierMatchContext(data, input.options);
  return planParsedCsvRowsWithBudget(parsed, planBudget, (rowNo, record) =>
    planSupplierCsvRow(rowNo, record, input.mapping, input.options, context),
  );
}
