import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const PURCHASE_PRICE_UNVERIFIED = 'PURCHASE_PRICE_UNVERIFIED';
export const PURCHASE_COST_STALE = 'PURCHASE_COST_STALE';

export type PurchaseCostSourceKind = 'vendor_article' | 'catalog_cost';

export type ResolvedPurchaseLineCost = {
  unitCostNet: string;
  source: {
    kind: PurchaseCostSourceKind;
    vendor_article_no: string | null;
    verified: true;
  };
};

type VendorArticleRow = {
  vendor_article_no: string;
  last_cost: Prisma.Decimal | null;
  updatedAt: Date;
};

export function formatUnitCostNet(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function resolvePurchaseLineCost(
  catalogItem: {
    id: string;
    cost_price: Prisma.Decimal | null;
  },
  vendorArticle: VendorArticleRow | undefined,
): ResolvedPurchaseLineCost {
  if (vendorArticle?.last_cost !== null && vendorArticle?.last_cost !== undefined) {
    return {
      unitCostNet: formatUnitCostNet(vendorArticle.last_cost),
      source: {
        kind: 'vendor_article',
        vendor_article_no: vendorArticle.vendor_article_no,
        verified: true,
      },
    };
  }
  if (catalogItem.cost_price !== null) {
    return {
      unitCostNet: formatUnitCostNet(catalogItem.cost_price),
      source: {
        kind: 'catalog_cost',
        vendor_article_no: null,
        verified: true,
      },
    };
  }
  throw new UnprocessableEntityException({
    code: PURCHASE_PRICE_UNVERIFIED,
    message:
      'Purchase unit cost is not verified for this vendor and catalog item; resolve the price manually before ordering.',
    catalog_item_id: catalogItem.id,
  });
}

export function assertCostBasisMatches(
  expected: { version: number; unit_cost_net: string },
  resolved: ResolvedPurchaseLineCost,
): void {
  if (expected.version !== 1) {
    throw new UnprocessableEntityException('Unsupported cost_basis version');
  }
  if (expected.unit_cost_net !== resolved.unitCostNet) {
    throw new UnprocessableEntityException({
      code: PURCHASE_COST_STALE,
      message:
        'Purchase unit cost changed since the cost basis was recorded; reload demand and cost before proposing again.',
      expected_unit_cost_net: expected.unit_cost_net,
      current_unit_cost_net: resolved.unitCostNet,
    });
  }
}
