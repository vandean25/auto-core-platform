import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, SalesOrderStatus } from '@prisma/client';
import type { AtpService } from '../inventory/atp.service.js';
import type { InvoiceSnapshotCommitService } from '../invoices/invoice-snapshot-commit.service.js';
import { InvoiceFinalizationService } from './invoice-finalization.service.js';

describe('InvoiceFinalizationService', () => {
  let service: InvoiceFinalizationService;

  const atpService = {
    calculateAtp: jest.fn(
      (stock: {
        quantity_on_hand: Prisma.Decimal | number;
        quantity_reserved: Prisma.Decimal | number;
      }) => ({
        quantityAvailable: new Prisma.Decimal(stock.quantity_on_hand).sub(
          stock.quantity_reserved,
        ),
      }),
    ),
    deductOnHandForSale: jest.fn(),
  } as unknown as AtpService;
  const snapshotCommit = {
    prepareV2Snapshot: jest.fn().mockResolvedValue({
      snapshot: { schema_version: 2 },
      ownership: { siteId: 'site-1', legalEntityId: 'le-1' },
      dueDate: new Date(),
      supplyFrom: new Date(),
      supplyTo: new Date(),
    }),
    persistV2Snapshot: jest.fn().mockResolvedValue(undefined),
  } as unknown as InvoiceSnapshotCommitService;

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    invoiceSequence: {
      upsert: jest.fn().mockResolvedValue({ current: 1 }),
    },
    inventoryStock: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    inventoryTransaction: {
      createMany: jest.fn(),
    },
    invoice: {
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    salesOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(() => {
    service = new InvoiceFinalizationService(atpService, snapshotCommit);
    jest.clearAllMocks();
    tx.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
    tx.$queryRaw.mockResolvedValue([]);
    atpService.deductOnHandForSale.mockResolvedValue(undefined);
  });

  it('finalizes invoice and transitions linked sales order', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.DRAFT,
        items: [],
        customer: { id: 'customer-1' },
        vehicle: null,
      })
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.FINALIZED,
        items: [],
        customer: { id: 'customer-1' },
      });
    tx.salesOrder.findFirst.mockResolvedValue({
      status: SalesOrderStatus.COMPLETED,
    });
    tx.salesOrder.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.finalizeInTransaction(
      tx as never,
      'tenant-1',
      {
        id: 'inv-1',
        sales_order_id: 'so-1',
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never,
    );

    expect(result.status).toBe(InvoiceStatus.FINALIZED);
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'so-1',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        status: SalesOrderStatus.COMPLETED,
      },
      data: { status: SalesOrderStatus.INVOICED },
    });
  });

  it('returns 409 when invoice status transition is stale', async () => {
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      items: [],
      customer: { id: 'customer-1' },
      vehicle: null,
    });
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: 'so-1',
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 409 when linked sales order status changed concurrently', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.DRAFT,
        items: [],
        customer: { id: 'customer-1' },
        vehicle: null,
      })
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.FINALIZED,
        items: [],
        customer: true,
      });
    tx.salesOrder.findFirst.mockResolvedValue({
      status: SalesOrderStatus.COMPLETED,
    });
    tx.salesOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: 'so-1',
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws when finalized invoice cannot be reloaded', async () => {
    tx.invoice.findFirst
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.DRAFT,
        items: [],
        customer: { id: 'customer-1' },
        vehicle: null,
      })
      .mockResolvedValueOnce(null);
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: 'so-1',
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not transition the invoice when ATP rejects a sale deduction', async () => {
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      items: [
        {
          catalog_item_id: 'catalog-1',
          description: 'Filter',
          quantity: 1,
        },
      ],
      customer: { id: 'customer-1' },
      vehicle: null,
    });
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: 2,
        quantity_reserved: 0,
      },
    ]);
    atpService.deductOnHandForSale.mockRejectedValue(
      new ConflictException('Insufficient ATP'),
    );

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: 'so-1',
        status: InvoiceStatus.DRAFT,
        items: [
          {
            catalog_item_id: 'catalog-1',
            description: 'Filter',
            quantity: 1,
          },
        ],
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.createMany).not.toHaveBeenCalled();
  });

  it('rejects source-less invoice finalization', async () => {
    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: null,
        workshop_order_id: null,
        vehicle_sale_id: null,
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not consume an invoice number when snapshot validation fails', async () => {
    snapshotCommit.prepareV2Snapshot.mockRejectedValue(
      new BadRequestException({
        code: 'SELLER_IDENTITY_INCOMPLETE',
        missingFields: ['vat_id'],
      }),
    );
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      items: [],
      customer: { id: 'customer-1' },
      vehicle: null,
    });

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: 'so-1',
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.invoiceSequence.upsert).not.toHaveBeenCalled();
    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryStock.findMany).not.toHaveBeenCalled();
  });

  it('rejects workshop-sourced drafts on the sales finalize path', async () => {
    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: null,
        workshop_order_id: 'wo-1',
        vehicle_sale_id: null,
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toMatchObject({
      response: {
        code: 'SOURCE_DOCUMENT_REQUIRED',
      },
    });
  });

  it('deducts inventory and transitions sales order using ownership site', async () => {
    snapshotCommit.prepareV2Snapshot.mockResolvedValue({
      snapshot: { schema_version: 2 },
      ownership: { siteId: 'ownership-site', legalEntityId: 'le-1' },
      dueDate: new Date(),
      supplyFrom: new Date(),
      supplyTo: new Date(),
    });
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.DRAFT,
        items: [
          {
            catalog_item_id: 'catalog-1',
            description: 'Filter',
            quantity: 1,
          },
        ],
        customer: { id: 'customer-1' },
        vehicle: null,
      })
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.FINALIZED,
        items: [],
        customer: { id: 'customer-1' },
      });
    tx.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'catalog-1',
        location_id: 'loc-1',
        quantity_on_hand: 10,
        quantity_reserved: 0,
      },
    ]);
    tx.salesOrder.findFirst.mockResolvedValue({
      status: SalesOrderStatus.COMPLETED,
    });
    tx.salesOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.finalizeInTransaction(tx as never, 'tenant-1', {
      id: 'inv-1',
      sales_order_id: 'so-1',
      status: InvoiceStatus.DRAFT,
      items: [
        {
          catalog_item_id: 'catalog-1',
          description: 'Filter',
          quantity: 1,
        },
      ],
    } as never);

    expect(tx.inventoryStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          location: expect.objectContaining({
            site_id: 'ownership-site',
          }),
        }),
      }),
    );
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'so-1',
        tenant_id: 'tenant-1',
        site_id: 'ownership-site',
        status: SalesOrderStatus.COMPLETED,
      },
      data: { status: SalesOrderStatus.INVOICED },
    });
  });
});
