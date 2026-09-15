import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  TransactionType,
  VehicleLedgerEntryType,
  WorkshopOrderPurpose,
} from '@prisma/client';
import { VehicleLedgerService } from './vehicle-ledger.service.js';

describe('VehicleLedgerService', () => {
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
