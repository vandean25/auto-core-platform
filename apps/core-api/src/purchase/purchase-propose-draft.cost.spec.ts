import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCostBasisMatches,
  indexVendorArticlesByCatalogItem,
  resolvePurchaseLineCost,
} from './purchase-propose-draft.cost.js';

describe('purchase-propose-draft.cost', () => {
  it('prefers vendor article last_cost over catalog cost', () => {
    const resolved = resolvePurchaseLineCost(
      { id: 'part-1', cost_price: new Prisma.Decimal('5.00') },
      {
        id: 'va-1',
        catalog_item_id: 'part-1',
        vendor_article_no: 'VA-1',
        last_cost: new Prisma.Decimal('7.50'),
        updatedAt: new Date(),
      },
    );
    expect(resolved.unitCostNet).toBe('7.50');
    expect(resolved.source.kind).toBe('vendor_article');
  });

  it('falls back to catalog cost when vendor article has no last_cost', () => {
    const resolved = resolvePurchaseLineCost(
      { id: 'part-1', cost_price: new Prisma.Decimal('4.25') },
      {
        id: 'va-1',
        catalog_item_id: 'part-1',
        vendor_article_no: 'VA-1',
        last_cost: null,
        updatedAt: new Date(),
      },
    );
    expect(resolved.unitCostNet).toBe('4.25');
    expect(resolved.source.kind).toBe('catalog_cost');
  });

  it('rejects unverified purchase price', () => {
    expect(() =>
      resolvePurchaseLineCost({ id: 'part-1', cost_price: null }, undefined),
    ).toThrow(UnprocessableEntityException);
  });

  it('picks the newest vendor article per catalog item, then lowest id', () => {
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-06-01T00:00:00.000Z');
    const indexed = indexVendorArticlesByCatalogItem([
      {
        id: 'b',
        catalog_item_id: 'part-1',
        vendor_article_no: 'OLD',
        last_cost: new Prisma.Decimal('1.00'),
        updatedAt: older,
      },
      {
        id: 'a',
        catalog_item_id: 'part-1',
        vendor_article_no: 'NEW-A',
        last_cost: new Prisma.Decimal('2.00'),
        updatedAt: newer,
      },
      {
        id: 'c',
        catalog_item_id: 'part-1',
        vendor_article_no: 'NEW-C',
        last_cost: new Prisma.Decimal('3.00'),
        updatedAt: newer,
      },
    ]);
    expect(indexed.get('part-1')?.vendor_article_no).toBe('NEW-A');
  });

  it('detects stale cost basis', () => {
    const resolved = resolvePurchaseLineCost(
      { id: 'part-1', cost_price: new Prisma.Decimal('10.00') },
      undefined,
    );
    expect(() =>
      assertCostBasisMatches(
        { version: 1, unit_cost_net: '9.99' },
        resolved,
      ),
    ).toThrow(UnprocessableEntityException);
  });
});
