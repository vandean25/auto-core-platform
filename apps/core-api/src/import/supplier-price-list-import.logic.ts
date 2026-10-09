import { ImportRowAction } from '@prisma/client';
import { parseGermanNumber } from './number-parse.util.js';
import {
  findMatchingMarginRule,
  retailFromCost,
  type MarginRuleItem,
} from '../margin-rule/retail-from-cost.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportRowIssue,
  NormalizedSupplierPriceListRow,
} from './import.types.js';

export type SupplierPriceListCatalogItem = {
  id: string;
  sku: string;
  name: string;
  cost_price: number | null;
  retail_price: number;
  ean?: string | null;
  brand_id?: number | null;
  revenue_group_id?: number | null;
};

export type SupplierPriceListMatchContext = {
  catalogItemByEan: Map<string, SupplierPriceListCatalogItem>;
  catalogItemByVendorArticleNo: Map<string, SupplierPriceListCatalogItem>;
  catalogItemBySku: Map<string, SupplierPriceListCatalogItem>;
  catalogItemById?: Map<string, SupplierPriceListCatalogItem>;
  brandByName?: Map<string, { id: number; name: string }>;
  marginRules?: MarginRuleItem[];
  priceJumpThresholdPercent?: number;
  articleNoSeenInFile?: Map<string, number>;
};

function cellValue(
  record: Record<string, string>,
  mapping: Record<string, string>,
  field: string,
): string {
  const column = mapping[field];
  if (column && record[column] !== undefined) {
    return record[column]?.trim() ?? '';
  }
  return record[field]?.trim() ?? '';
}

export function normalizeSupplierPriceListRow(
  record: Record<string, string>,
  mapping: Record<string, string>,
  options?: ImportJobOptions,
): {
  row: NormalizedSupplierPriceListRow | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
} {
  void options;
  const issues: ImportRowIssue[] = [];
  const warnings: ImportRowIssue[] = [];

  const supplierArticleNo = cellValue(record, mapping, 'supplier_article_no');
  if (!supplierArticleNo) {
    issues.push({
      code: IMPORT_ERROR_CODES.SUPPLIER_ARTICLE_NO_REQUIRED,
      message: 'Lieferanten-Artikelnummer ist erforderlich',
      field: 'supplier_article_no',
    });
  }

  const description = cellValue(record, mapping, 'description');
  if (!description) {
    issues.push({
      code: IMPORT_ERROR_CODES.DESCRIPTION_REQUIRED,
      message: 'Beschreibung ist erforderlich',
      field: 'description',
    });
  }

  const rawCost = cellValue(record, mapping, 'cost_price');
  const cost = parseGermanNumber(rawCost);
  if (cost === null || cost <= 0) {
    issues.push({
      code: IMPORT_ERROR_CODES.INVALID_COST_PRICE,
      message: 'Gültiger Einkaufspreis ist erforderlich (muss positiv sein)',
      field: 'cost_price',
    });
  }

  const rawEan = cellValue(record, mapping, 'ean');
  const ean = rawEan.length > 0 ? rawEan : null;

  const rawBrand = cellValue(record, mapping, 'brand');
  const brand = rawBrand.length > 0 ? rawBrand : null;

  const rawRrp = cellValue(record, mapping, 'rrp');
  const rrp = rawRrp.length > 0 ? parseGermanNumber(rawRrp) : null;

  const rawUnit = cellValue(record, mapping, 'unit');
  const unit = rawUnit.length > 0 ? rawUnit : 'pcs';

  if (issues.length > 0) {
    return { row: null, issues, warnings };
  }

  const row: NormalizedSupplierPriceListRow = {
    supplier_article_no: supplierArticleNo,
    ean,
    description,
    brand,
    cost_price: cost!,
    rrp,
    unit,
  };

  return { row, issues: [], warnings };
}

export function planSupplierPriceListDryRunRow(
  rowNo: number,
  row: NormalizedSupplierPriceListRow | null,
  context: SupplierPriceListMatchContext,
  options?: ImportJobOptions,
  warnings: ImportRowIssue[] = [],
  errors: ImportRowIssue[] = [],
): DryRunRowResult {
  const rowWarnings = [...warnings];
  const rowErrors = [...errors];

  if (!row) {
    return {
      row_no: rowNo,
      external_id: null,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: rowErrors,
      warnings: rowWarnings,
      normalized: null,
    };
  }

  if (!row.supplier_article_no || !row.supplier_article_no.trim()) {
    return {
      row_no: rowNo,
      external_id: null,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: [
        {
          code: IMPORT_ERROR_CODES.SUPPLIER_ARTICLE_NO_REQUIRED,
          message: 'Lieferanten-Artikelnummer ist erforderlich',
          field: 'supplier_article_no',
        },
      ],
      warnings: rowWarnings,
      normalized: null,
    };
  }

  if (
    row.cost_price == null ||
    !Number.isFinite(row.cost_price) ||
    row.cost_price <= 0
  ) {
    return {
      row_no: rowNo,
      external_id: row.supplier_article_no,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: [
        {
          code: IMPORT_ERROR_CODES.INVALID_COST_PRICE,
          message: 'Gültiger Einkaufspreis ist erforderlich',
          field: 'cost_price',
        },
      ],
      warnings: rowWarnings,
      normalized: null,
    };
  }

  if (context.articleNoSeenInFile) {
    const priorRow = context.articleNoSeenInFile.get(row.supplier_article_no);
    if (priorRow !== undefined && priorRow !== rowNo) {
      return {
        row_no: rowNo,
        external_id: row.supplier_article_no,
        action: ImportRowAction.ERROR,
        entity_id: null,
        errors: [
          {
            code: IMPORT_ERROR_CODES.DUPLICATE_ARTICLE_NO_IN_FILE,
            message: `Doppelte Artikelnummer in Datei (zuerst in Zeile ${priorRow})`,
            field: 'supplier_article_no',
          },
        ],
        warnings: rowWarnings,
        normalized: null,
      };
    }
    context.articleNoSeenInFile.set(row.supplier_article_no, rowNo);
  }

  // Match Order: (1) EAN -> (2) Vendor article mapping -> (3) SKU
  let matchedItem: SupplierPriceListCatalogItem | null = null;
  let matchMethod: 'EAN' | 'VENDOR_ARTICLE_NO' | 'SKU' | null = null;

  if (row.ean && row.ean.trim().length > 0) {
    const eanKey = row.ean.trim();
    const item = context.catalogItemByEan.get(eanKey);
    if (item) {
      matchedItem = item;
      matchMethod = 'EAN';
    }
  }

  if (!matchedItem && row.supplier_article_no) {
    const artKey = row.supplier_article_no.trim();
    const item =
      context.catalogItemByVendorArticleNo.get(artKey) ??
      context.catalogItemByVendorArticleNo.get(artKey.toUpperCase());
    if (item) {
      matchedItem = item;
      matchMethod = 'VENDOR_ARTICLE_NO';
    }
  }

  if (!matchedItem && row.supplier_article_no) {
    const skuKey = row.supplier_article_no.trim();
    const item =
      context.catalogItemBySku.get(skuKey) ??
      context.catalogItemBySku.get(skuKey.toUpperCase());
    if (item) {
      matchedItem = item;
      matchMethod = 'SKU';
    }
  }

  let brandId: number | null = matchedItem?.brand_id ?? null;
  if (row.brand && context.brandByName) {
    const brandEntry = context.brandByName.get(row.brand.trim().toLowerCase());
    if (brandEntry) {
      brandId = brandEntry.id;
    }
  }

  const revenueGroupId = matchedItem?.revenue_group_id ?? null;

  const newCost = Math.round(row.cost_price * 100) / 100;

  const marginRules = context.marginRules ?? [];
  const calculatedRetail = retailFromCost(newCost, row.rrp, marginRules, {
    brandId,
    revenueGroupId,
  });

  let newRetail: number;
  if (calculatedRetail !== null) {
    newRetail = calculatedRetail;
  } else if (matchedItem) {
    newRetail = Math.round(matchedItem.retail_price * 100) / 100;
    const matchedRule = findMatchingMarginRule(newCost, marginRules, {
      brandId,
      revenueGroupId,
    });
    if (matchedRule?.use_supplier_rrp && (row.rrp == null || row.rrp <= 0)) {
      rowWarnings.push({
        code: 'RRP_MISSING_FOR_MARGIN_RULE',
        message:
          'Keine UVP vorhanden und kein Aufschlag definiert; bestehender Verkaufspreis bleibt unverändert',
        field: 'rrp',
      });
    }
  } else {
    newRetail =
      row.rrp != null && row.rrp > 0
        ? Math.round(row.rrp * 100) / 100
        : newCost;
  }

  const oldCost =
    matchedItem?.cost_price != null
      ? Math.round(matchedItem.cost_price * 100) / 100
      : null;
  const oldRetail =
    matchedItem != null
      ? Math.round(matchedItem.retail_price * 100) / 100
      : null;

  const thresholdPercent =
    options?.price_jump_threshold_percent ??
    context.priceJumpThresholdPercent ??
    20;

  let costChangePercent: number | null = null;
  let retailChangePercent: number | null = null;
  let priceJumpFlagged = false;

  if (oldCost != null && oldCost > 0) {
    costChangePercent =
      Math.round(((newCost - oldCost) / oldCost) * 10000) / 100;
    if (Math.abs(costChangePercent) > thresholdPercent) {
      priceJumpFlagged = true;
    }
  }

  if (oldRetail != null && oldRetail > 0 && newRetail != null) {
    retailChangePercent =
      Math.round(((newRetail - oldRetail) / oldRetail) * 10000) / 100;
    if (Math.abs(retailChangePercent) > thresholdPercent) {
      priceJumpFlagged = true;
    }
  }

  if (priceJumpFlagged) {
    rowWarnings.push({
      code: IMPORT_ERROR_CODES.PRICE_JUMP_EXCEEDED,
      message: `Preissprung überschreitet Schwellenwert von ${thresholdPercent}%`,
      field:
        costChangePercent != null &&
        Math.abs(costChangePercent) > thresholdPercent
          ? 'cost_price'
          : 'retail_price',
    });
  }

  let action: ImportRowAction;
  let entityId: string | null;

  if (matchedItem) {
    entityId = matchedItem.id;
    const costChanged = oldCost == null || Math.abs(newCost - oldCost) >= 0.005;
    const retailChanged =
      oldRetail == null || Math.abs(newRetail - oldRetail) >= 0.005;

    if (costChanged || retailChanged) {
      action = ImportRowAction.UPDATE;
    } else {
      action = ImportRowAction.SKIP;
    }
  } else {
    entityId = null;
    if (options?.create_new_catalog_items === true) {
      action = ImportRowAction.CREATE;
    } else {
      action = ImportRowAction.SKIP;
      rowWarnings.push({
        code: IMPORT_ERROR_CODES.ARTICLE_NOT_FOUND,
        message:
          'Artikel nicht im Katalog gefunden und Neuanlage ist deaktiviert',
        field: 'supplier_article_no',
      });
    }
  }

  const normalized = {
    supplier_article_no: row.supplier_article_no,
    ean: row.ean,
    description: row.description,
    brand: row.brand,
    brand_id: brandId,
    cost_price: newCost,
    retail_price: newRetail,
    rrp: row.rrp,
    unit: row.unit,
    old_cost_price: oldCost,
    old_retail_price: oldRetail,
    cost_change_percent: costChangePercent,
    retail_change_percent: retailChangePercent,
    price_jump_flagged: priceJumpFlagged,
    match_method: matchMethod,
  };

  return {
    row_no: rowNo,
    external_id: row.supplier_article_no,
    action,
    entity_id: entityId,
    errors: rowErrors,
    warnings: rowWarnings,
    normalized,
  };
}
