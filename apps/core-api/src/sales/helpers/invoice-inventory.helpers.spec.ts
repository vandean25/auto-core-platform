import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { processSaleInventoryDeduction } from './invoice-inventory.helpers';

describe('invoice-inventory.helpers', () => {
  const tx = {
    inventoryStock: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    inventoryTransaction: {
      createMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.inventoryStock.updateMany.mockResolvedValue({ count: 1 });
  });

  it('deducts stock and records inventory transactions', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: 5,
      },
    ]);

    await processSaleInventoryDeduction(
      tx as never,
      'tenant-1',
      [
        {
          catalog_item_id: 'catalog-1',
          description: 'Filter',
          quantity: new Prisma.Decimal(2),
        } as never,
      ],
      'RE-2026-0001',
    );

    expect(tx.inventoryStock.updateMany).toHaveBeenCalledWith({
      where: {
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: { gte: 2 },
      },
      data: {
        quantity_on_hand: { decrement: 2 },
      },
    });
    expect(tx.inventoryTransaction.createMany).toHaveBeenCalled();
  });

  it('rejects fractional quantities for stock-tracked items', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: 5,
      },
    ]);

    await expect(
      processSaleInventoryDeduction(
        tx as never,
        'tenant-1',
        [
          {
            catalog_item_id: 'catalog-1',
            description: 'Filter',
            quantity: new Prisma.Decimal(1.5),
          } as never,
        ],
        'RE-2026-0001',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects deductions when stock is insufficient', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: 1,
      },
    ]);

    await expect(
      processSaleInventoryDeduction(
        tx as never,
        'tenant-1',
        [
          {
            catalog_item_id: 'catalog-1',
            description: 'Filter',
            quantity: new Prisma.Decimal(2),
          } as never,
        ],
        'RE-2026-0001',
      ),
    ).rejects.toThrow('Insufficient stock for item Filter');
  });

  it('skips non-catalog invoice lines', async () => {
    await processSaleInventoryDeduction(
      tx as never,
      'tenant-1',
      [
        {
          catalog_item_id: null,
          description: 'Labor',
          quantity: new Prisma.Decimal(1),
        } as never,
      ],
      'RE-2026-0001',
    );

    expect(tx.inventoryStock.findMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.createMany).not.toHaveBeenCalled();
  });
});
