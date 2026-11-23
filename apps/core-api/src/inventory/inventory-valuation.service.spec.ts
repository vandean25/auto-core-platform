import { Prisma, TransactionType } from '@prisma/client';
import { InventoryValuationService } from './inventory-valuation.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

import Decimal = Prisma.Decimal;

describe('InventoryValuationService', () => {
  const TENANT_ID = 'tenant-1';
  const LEGAL_ENTITY_ID = 'le-1';
  const SITE_ID = 'site-1';
  const ITEM_ID = 'item-1';

  let mockPrisma: any;
  let service: InventoryValuationService;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn((cb: (tx: any) => any) => cb(mockPrisma)),
      site: {
        findMany: jest.fn(),
      },
      inventoryTransaction: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      catalogItem: {
        findFirst: jest.fn(),
      },
      vendorArticle: {
        findFirst: jest.fn(),
      },
      inventoryValuation: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new InventoryValuationService(mockPrisma as PrismaService);
  });

  describe('resolveLastEk (Scenario 10)', () => {
    it('returns latest same-legal-entity PURCHASE_RECEIPT.cost_basis first', async () => {
      mockPrisma.site.findMany.mockResolvedValue([{ id: SITE_ID }]);
      mockPrisma.inventoryTransaction.findFirst.mockResolvedValue({
        cost_basis: new Decimal('14.2500'),
      });

      const result = await service.resolveLastEk(
        mockPrisma,
        TENANT_ID,
        LEGAL_ENTITY_ID,
        ITEM_ID,
      );

      expect(result?.toFixed(4)).toBe('14.2500');
      expect(mockPrisma.catalogItem.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.vendorArticle.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to CatalogItem.cost_price when no valued receipt exists in the legal entity', async () => {
      mockPrisma.site.findMany.mockResolvedValue([{ id: SITE_ID }]);
      mockPrisma.inventoryTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.catalogItem.findFirst.mockResolvedValue({
        cost_price: new Decimal('19.90'),
      });

      const result = await service.resolveLastEk(
        mockPrisma,
        TENANT_ID,
        LEGAL_ENTITY_ID,
        ITEM_ID,
      );

      expect(result?.toFixed(2)).toBe('19.90');
      expect(mockPrisma.vendorArticle.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to newest VendorArticle.last_cost when CatalogItem.cost_price is null', async () => {
      mockPrisma.site.findMany.mockResolvedValue([]);
      mockPrisma.catalogItem.findFirst.mockResolvedValue({ cost_price: null });
      mockPrisma.vendorArticle.findFirst.mockResolvedValue({
        last_cost: new Decimal('21.50'),
      });

      const result = await service.resolveLastEk(
        mockPrisma,
        TENANT_ID,
        LEGAL_ENTITY_ID,
        ITEM_ID,
      );

      expect(result?.toFixed(2)).toBe('21.50');
    });

    it('returns null when no last EK source exists', async () => {
      mockPrisma.site.findMany.mockResolvedValue([]);
      mockPrisma.catalogItem.findFirst.mockResolvedValue({ cost_price: null });
      mockPrisma.vendorArticle.findFirst.mockResolvedValue(null);

      const result = await service.resolveLastEk(
        mockPrisma,
        TENANT_ID,
        LEGAL_ENTITY_ID,
        ITEM_ID,
      );

      expect(result).toBeNull();
    });
  });

  describe('backfillTenant (Scenario 5 & Anti-criterion 2)', () => {
    it('values the valued portion, reports unvalued gaps, and never invents a cost', async () => {
      mockPrisma.site.findMany.mockResolvedValue([
        { id: SITE_ID, legal_entity_id: LEGAL_ENTITY_ID },
      ]);
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          seq: BigInt(1),
          site_id: SITE_ID,
          item_id: ITEM_ID,
          quantity: new Decimal(10),
          type: TransactionType.PURCHASE_RECEIPT,
          cost_basis: new Decimal('10.00'),
          createdAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 'tx-2',
          seq: BigInt(2),
          site_id: SITE_ID,
          item_id: ITEM_ID,
          quantity: new Decimal(5),
          type: TransactionType.ADJUSTMENT,
          cost_basis: null,
          createdAt: new Date('2026-01-02T10:00:00Z'),
        },
        {
          id: 'tx-3',
          seq: BigInt(3),
          site_id: SITE_ID,
          item_id: 'item-only-unvalued',
          quantity: new Decimal(3),
          type: TransactionType.ADJUSTMENT,
          cost_basis: null,
          createdAt: new Date('2026-01-03T10:00:00Z'),
        },
      ]);

      const report = await service.backfillTenant(TENANT_ID);

      expect(report.processedTransactions).toBe(3);
      expect(report.valuationsUpserted).toBe(2);
      expect(report.gapCount).toBe(2);
      expect(report.gaps).toEqual([
        {
          legalEntityId: LEGAL_ENTITY_ID,
          catalogItemId: ITEM_ID,
          unvaluedInboundCount: 1,
          unvaluedOutboundCount: 0,
          transactionIds: ['tx-2'],
        },
        {
          legalEntityId: LEGAL_ENTITY_ID,
          catalogItemId: 'item-only-unvalued',
          unvaluedInboundCount: 1,
          unvaluedOutboundCount: 0,
          transactionIds: ['tx-3'],
        },
      ]);
      expect(mockPrisma.catalogItem.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.vendorArticle.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('prepareAndLockBatch (Anti-criterion 1)', () => {
    it('never scans historical InventoryTransaction rows during live bookings', async () => {
      mockPrisma.site.findMany.mockResolvedValue([
        { id: SITE_ID, legal_entity_id: LEGAL_ENTITY_ID },
      ]);
      mockPrisma.inventoryValuation.findMany
        .mockResolvedValueOnce([{ id: 'val-1' }])
        .mockResolvedValueOnce([
          {
            id: 'val-1',
            tenant_id: TENANT_ID,
            legal_entity_id: LEGAL_ENTITY_ID,
            catalog_item_id: ITEM_ID,
            average_unit_cost: new Decimal('10.0000'),
            valued_quantity: new Decimal('5.000'),
            last_booking_seq: BigInt(10),
          },
        ]);

      const prepared = await service.prepareAndLockBatch(mockPrisma, TENANT_ID, [
        {
          itemId: ITEM_ID,
          siteId: SITE_ID,
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 20,
        },
      ]);
      await prepared.commit(new Map([[0, BigInt(11)]]));

      expect(mockPrisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.inventoryTransaction.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.inventoryValuation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'val-1', tenant_id: TENANT_ID },
          data: expect.objectContaining({
            average_unit_cost: new Decimal('15'),
            valued_quantity: new Decimal('10'),
            last_booking_seq: BigInt(11),
          }),
        }),
      );
    });

    it('seeds an unseeded valuation row from historical journal before applying the first live booking', async () => {
      mockPrisma.site.findMany
        .mockResolvedValueOnce([{ id: SITE_ID, legal_entity_id: LEGAL_ENTITY_ID }])
        .mockResolvedValueOnce([{ id: SITE_ID, legal_entity_id: LEGAL_ENTITY_ID }]);
      mockPrisma.inventoryValuation.findMany
        .mockResolvedValueOnce([{ id: 'val-new' }])
        .mockResolvedValueOnce([
          {
            id: 'val-new',
            tenant_id: TENANT_ID,
            legal_entity_id: LEGAL_ENTITY_ID,
            catalog_item_id: ITEM_ID,
            average_unit_cost: null,
            valued_quantity: new Decimal('0'),
            last_booking_seq: null,
          },
        ]);
      mockPrisma.inventoryTransaction.findMany.mockResolvedValueOnce([
        {
          seq: BigInt(5),
          site_id: SITE_ID,
          item_id: ITEM_ID,
          quantity: new Decimal(10),
          type: TransactionType.PURCHASE_RECEIPT,
          cost_basis: new Decimal('10.0000'),
        },
      ]);

      const prepared = await service.prepareAndLockBatch(mockPrisma, TENANT_ID, [
        {
          itemId: ITEM_ID,
          siteId: SITE_ID,
          quantity: 10,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 20,
        },
      ]);
      await prepared.commit(new Map([[0, BigInt(12)]]));

      expect(mockPrisma.inventoryValuation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'val-new', tenant_id: TENANT_ID },
          data: expect.objectContaining({
            average_unit_cost: new Decimal('15'),
            valued_quantity: new Decimal('20'),
            last_booking_seq: BigInt(12),
          }),
        }),
      );
    });
  });
});
