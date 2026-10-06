import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  TransactionType,
  VehicleLedgerEntryType,
  WorkshopOrderPurpose,
} from '@prisma/client';
import { VehicleLedgerService } from './vehicle-ledger.service.js';

describe('VehicleLedgerService', () => {
  it('adds stock preparation costs to the current stock cycle snapshot', async () => {
    const tx = {
      vehicle: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'vehicle-1',
          site_id: 'site-1',
          inventory_role: 'USED',
          stock_status: 'IN_STOCK',
          stock_received_at: new Date('2026-10-01T00:00:00Z'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicleLedgerEntry: {
        create: jest.fn().mockResolvedValue({ id: 'entry-1' }),
      },
    } as unknown as Prisma.TransactionClient;
    const service = new VehicleLedgerService(
      {} as never,
      { validateTransactionDate: jest.fn() } as never,
      { getTenantId: jest.fn().mockResolvedValue('tenant-1') } as never,
    );

    await service.append({
      vehicleId: 'vehicle-1',
      entryType: VehicleLedgerEntryType.WORKSHOP_COST,
      amount: new Prisma.Decimal('250.00'),
    }, tx);

    expect(tx.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'vehicle-1',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
        stock_received_at: { not: null },
      },
      data: { stock_cost_basis: { increment: new Prisma.Decimal('250.00') } },
    });
  });

  it('rejects STOCK_PREP when consumption cost basis is null before posting', async () => {
    const tx = {
      workshopOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          vehicle_id: 'vehicle-1',
          purpose: WorkshopOrderPurpose.STOCK_PREP,
          vehicle: { reserved_for_customer_id: null },
          tasks: [{ line_items: [] }],
        }),
      },
      vehicleLedgerEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      inventoryTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            quantity: new Prisma.Decimal('-1.5'),
            cost_basis: null,
            type: TransactionType.WORKSHOP_CONSUMPTION,
          },
        ]),
      },
      vehicle: {
        updateMany: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;
    const service = new VehicleLedgerService(
      {} as never,
      {} as never,
      { getTenantId: jest.fn() } as never,
    );
    const append = jest
      .spyOn(service, 'append')
      .mockResolvedValue({} as Prisma.VehicleLedgerEntry);

    await expect(
      service.completeStockPrep(tx, 'tenant-1', 'order-1'),
    ).rejects.toThrow(ConflictException);

    expect(append).not.toHaveBeenCalled();
    expect(tx.vehicleLedgerEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entry_type: VehicleLedgerEntryType.WORKSHOP_COST,
        }),
      }),
    );
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
  });
});
