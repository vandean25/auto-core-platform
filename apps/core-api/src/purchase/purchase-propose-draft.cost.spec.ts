import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCostBasisMatches,
  resolvePurchaseLineCost,
} from './purchase-propose-draft.cost.js';

describe('purchase-propose-draft.cost', () => {
  it('prefers vendor article last_cost over catalog cost', () => {
    const resolved = resolvePurchaseLineCost(
      { id: 'part-1', cost_price: new Prisma.Decimal('5.00') },
      {
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
