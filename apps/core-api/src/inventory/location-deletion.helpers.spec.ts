import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCanDeleteLocationBasic,
  assertNoOutstandingStockTransfers,
  assertNoParkedDealerVehicles,
  hasOutstandingTransferQty,
} from './location-deletion.helpers.js';

describe('location-deletion.helpers', () => {
  describe('assertCanDeleteLocationBasic', () => {
    it('throws ConflictException if location is a system location', () => {
      expect(() =>
        assertCanDeleteLocationBasic({
          is_system: true,
          _count: { children: 0, stocks: 0 },
        }),
      ).toThrow(new ConflictException('System locations cannot be deleted'));
    });

    it('throws BadRequestException if location has children', () => {
      expect(() =>
        assertCanDeleteLocationBasic({
          is_system: false,
          _count: { children: 2, stocks: 0 },
        }),
      ).toThrow(
        new BadRequestException(
          'Cannot delete location with children. Delete children first.',
        ),
      );
    });

    it('throws BadRequestException if location contains stock', () => {
      expect(() =>
        assertCanDeleteLocationBasic({
          is_system: false,
          _count: { children: 0, stocks: 5 },
        }),
      ).toThrow(
        new BadRequestException('Cannot delete location containing stock.'),
      );
    });

    it('passes if location is non-system and has no children or stocks', () => {
      expect(() =>
        assertCanDeleteLocationBasic({
          is_system: false,
          _count: { children: 0, stocks: 0 },
        }),
      ).not.toThrow();
    });
  });

  describe('assertNoParkedDealerVehicles', () => {
    it('throws ConflictException if dealer parked vehicles exist in lot', async () => {
      const tx = {
        vehicle: {
          count: jest.fn().mockResolvedValue(3),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        assertNoParkedDealerVehicles(tx, 'tenant-1', 'loc-1'),
      ).rejects.toThrow(
        new ConflictException(
          'Cannot delete or disable a lot with parked dealer vehicles. Move or sell the vehicles first.',
        ),
      );

      expect(tx.vehicle.count).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          location_id: 'loc-1',
          inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
          stock_status: { in: ['IN_STOCK', 'RESERVED', 'IN_PREP'] },
        },
      });
    });

    it('passes if count is 0', async () => {
      const tx = {
        vehicle: {
          count: jest.fn().mockResolvedValue(0),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        assertNoParkedDealerVehicles(tx, 'tenant-1', 'loc-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('hasOutstandingTransferQty', () => {
    it('returns true if source location has approved_qty > 0', () => {
      const lines = [
        {
          source_location_id: 'loc-source',
          dest_location_id: 'loc-other',
          approved_qty: new Prisma.Decimal(2),
          shipped_qty: new Prisma.Decimal(0),
          received_qty: new Prisma.Decimal(0),
          returned_qty: new Prisma.Decimal(0),
        },
      ];
      expect(hasOutstandingTransferQty(lines, 'loc-source')).toBe(true);
    });

    it('returns true if source location has outstanding shipped qty', () => {
      const lines = [
        {
          source_location_id: 'loc-source',
          dest_location_id: 'loc-other',
          approved_qty: new Prisma.Decimal(0),
          shipped_qty: new Prisma.Decimal(5),
          received_qty: new Prisma.Decimal(2),
          returned_qty: new Prisma.Decimal(1),
        },
      ];
      // outstanding = 5 - (2 + 1) = 2 > 0
      expect(hasOutstandingTransferQty(lines, 'loc-source')).toBe(true);
    });

    it('returns true if destination location has outstanding qty', () => {
      const lines = [
        {
          source_location_id: 'loc-source',
          dest_location_id: 'loc-dest',
          approved_qty: new Prisma.Decimal(0),
          shipped_qty: new Prisma.Decimal(10),
          received_qty: new Prisma.Decimal(7),
          returned_qty: new Prisma.Decimal(0),
        },
      ];
      expect(hasOutstandingTransferQty(lines, 'loc-dest')).toBe(true);
    });

    it('returns false if destination location has 0 outstanding (all received/returned)', () => {
      const lines = [
        {
          source_location_id: 'loc-source',
          dest_location_id: 'loc-dest',
          approved_qty: new Prisma.Decimal(0),
          shipped_qty: new Prisma.Decimal(10),
          received_qty: new Prisma.Decimal(8),
          returned_qty: new Prisma.Decimal(2),
        },
      ];
      expect(hasOutstandingTransferQty(lines, 'loc-dest')).toBe(false);
    });

    it('returns false if location is unrelated or has zero outstanding', () => {
      const lines = [
        {
          source_location_id: 'loc-other-1',
          dest_location_id: 'loc-other-2',
          approved_qty: new Prisma.Decimal(5),
          shipped_qty: new Prisma.Decimal(5),
          received_qty: new Prisma.Decimal(0),
          returned_qty: new Prisma.Decimal(0),
        },
      ];
      expect(hasOutstandingTransferQty(lines, 'loc-target')).toBe(false);
    });
  });

  describe('assertNoOutstandingStockTransfers', () => {
    it('queries open transfers for tenant and site and throws ConflictException if outstanding qty exists', async () => {
      const tx = {
        stockTransferLine: {
          findMany: jest.fn().mockResolvedValue([
            {
              source_location_id: 'loc-1',
              dest_location_id: 'loc-2',
              approved_qty: new Prisma.Decimal(1),
              shipped_qty: new Prisma.Decimal(0),
              received_qty: new Prisma.Decimal(0),
              returned_qty: new Prisma.Decimal(0),
            },
          ]),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        assertNoOutstandingStockTransfers(tx, 'tenant-1', 'site-1', 'loc-1'),
      ).rejects.toThrow(
        new ConflictException(
          'Cannot delete or disable a location referenced by a stock transfer with outstanding quantity.',
        ),
      );

      expect(tx.stockTransferLine.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          transfer: { status: { in: ['REQUESTED', 'APPROVED', 'SHIPPED'] } },
          OR: [
            { from_site_id: 'site-1', source_location_id: 'loc-1' },
            { to_site_id: 'site-1', dest_location_id: 'loc-1' },
          ],
        },
        select: {
          source_location_id: true,
          dest_location_id: true,
          approved_qty: true,
          shipped_qty: true,
          received_qty: true,
          returned_qty: true,
        },
      });
    });

    it('resolves if no lines have outstanding quantity', async () => {
      const tx = {
        stockTransferLine: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        assertNoOutstandingStockTransfers(tx, 'tenant-1', 'site-1', 'loc-1'),
      ).resolves.toBeUndefined();
    });
  });
});
