import { ConflictException } from '@nestjs/common';
import { LocationType, Prisma, TransactionType } from '@prisma/client';
import type { AtpService } from '../../inventory/atp.service';
import { processSaleInventoryDeduction } from './invoice-inventory.helpers';

describe('invoice-inventory.helpers', () => {
  const tx = {
    inventoryStock: {
      findMany: jest.fn(),
    },
    inventoryTransaction: {
      createMany: jest.fn(),
    },
  };

  const atpService = {
    calculateAtp: jest.fn((stock: {
      quantity_on_hand: Prisma.Decimal;
      quantity_reserved: Prisma.Decimal;
    }) => ({
      quantityAvailable: new Prisma.Decimal(stock.quantity_on_hand).sub(
        stock.quantity_reserved,
      ),
    })),
    deductOnHandForSale: jest.fn(),
  } as unknown as AtpService;

  const baseParams = {
    tx: tx as never,
    tenantId: 'tenant-1',
    siteId: 'site-1',
    invoiceNumber: 'RE-2026-0001',
    atpService,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.inventoryStock.findMany.mockResolvedValue([]);
    atpService.deductOnHandForSale.mockResolvedValue(undefined);
  });

  it('deducts free ATP and records SALE_ISSUE inventory transactions', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: new Prisma.Decimal(5),
        quantity_reserved: new Prisma.Decimal(2),
      },
    ]);

    await processSaleInventoryDeduction({
      ...baseParams,
      invoiceItems: [
        {
          catalog_item_id: 'catalog-1',
          description: 'Filter',
          quantity: new Prisma.Decimal(2),
        } as never,
      ],
    });

    expect(atpService.deductOnHandForSale).toHaveBeenCalledWith(
      {
        stockId: 'stock-1',
        quantity: new Prisma.Decimal(2),
        tenantId: 'tenant-1',
        siteId: 'site-1',
      },
      tx,
    );
    expect(tx.inventoryTransaction.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenant_id: 'tenant-1',
          item_id: 'catalog-1',
          location_id: 'loc-1',
          quantity: new Prisma.Decimal(-2),
          type: TransactionType.SALE_ISSUE,
          reference_id: 'RE-2026-0001',
        },
      ],
    });
  });

  it('does not sell reserved quantity when free ATP is insufficient', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: new Prisma.Decimal(2),
        quantity_reserved: new Prisma.Decimal(2),
      },
    ]);

    await expect(
      processSaleInventoryDeduction({
        ...baseParams,
        invoiceItems: [
          {
            catalog_item_id: 'catalog-1',
            description: 'Filter',
            quantity: new Prisma.Decimal(1),
          } as never,
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(atpService.deductOnHandForSale).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.createMany).not.toHaveBeenCalled();
  });

  it('filters stock selection to the tenant active site and non-tote locations', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: new Prisma.Decimal(1),
        quantity_reserved: new Prisma.Decimal(0),
      },
    ]);

    await processSaleInventoryDeduction({
      ...baseParams,
      invoiceItems: [
        {
          catalog_item_id: 'catalog-1',
          description: 'Filter',
          quantity: new Prisma.Decimal(1),
        } as never,
      ],
    });

    expect(tx.inventoryStock.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        catalog_item_id: { in: ['catalog-1'] },
        location: {
          tenant_id: 'tenant-1',
          site_id: 'site-1',
          type: { not: LocationType.staging_tote },
        },
      },
      orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
    });
  });

  it('rolls back sale ledger creation when the conditional ATP deduction loses a race', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: new Prisma.Decimal(2),
        quantity_reserved: new Prisma.Decimal(0),
      },
    ]);
    atpService.deductOnHandForSale.mockRejectedValue(
      new ConflictException('Insufficient ATP'),
    );

    await expect(
      processSaleInventoryDeduction({
        ...baseParams,
        invoiceItems: [
          {
            catalog_item_id: 'catalog-1',
            description: 'Filter',
            quantity: new Prisma.Decimal(2),
          } as never,
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.inventoryTransaction.createMany).not.toHaveBeenCalled();
  });

  it('splits a Decimal sale across eligible locations without selling reserved ATP', async () => {
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: new Prisma.Decimal('2.5'),
        quantity_reserved: new Prisma.Decimal('1.5'),
      },
      {
        id: 'stock-2',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-2',
        quantity_on_hand: new Prisma.Decimal('1.25'),
        quantity_reserved: new Prisma.Decimal('0.25'),
      },
    ]);

    await processSaleInventoryDeduction({
      ...baseParams,
      invoiceItems: [
        {
          catalog_item_id: 'catalog-1',
          description: 'Filter',
          quantity: new Prisma.Decimal('1.5'),
        } as never,
      ],
    });

    expect(atpService.deductOnHandForSale).toHaveBeenCalledTimes(2);
    expect(atpService.deductOnHandForSale).toHaveBeenNthCalledWith(
      1,
      {
        stockId: 'stock-1',
        quantity: new Prisma.Decimal('1'),
        tenantId: 'tenant-1',
        siteId: 'site-1',
      },
      tx,
    );
    expect(atpService.deductOnHandForSale).toHaveBeenNthCalledWith(
      2,
      {
        stockId: 'stock-2',
        quantity: new Prisma.Decimal('0.5'),
        tenantId: 'tenant-1',
        siteId: 'site-1',
      },
      tx,
    );
  });

  it('skips non-catalog invoice lines', async () => {
    await processSaleInventoryDeduction({
      ...baseParams,
      invoiceItems: [
        {
          catalog_item_id: null,
          description: 'Labor',
          quantity: new Prisma.Decimal(1),
        } as never,
      ],
    });

    expect(tx.inventoryStock.findMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.createMany).not.toHaveBeenCalled();
  });
});
