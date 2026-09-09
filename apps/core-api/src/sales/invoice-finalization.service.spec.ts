import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, SalesOrderStatus } from '@prisma/client';
import { InvoiceFinalizationService } from './invoice-finalization.service';

describe('InvoiceFinalizationService', () => {
  let service: InvoiceFinalizationService;

  const tx = {
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
    service = new InvoiceFinalizationService();
    jest.clearAllMocks();
    tx.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
  });

  it('finalizes invoice and transitions linked sales order', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.FINALIZED,
      items: [],
      customer: { id: 'customer-1' },
    });
    tx.salesOrder.findFirst.mockResolvedValue({
      status: SalesOrderStatus.COMPLETED,
    });
    tx.salesOrder.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.finalizeInTransaction(tx as never, 'tenant-1', {
      id: 'inv-1',
      sales_order_id: 'so-1',
      status: InvoiceStatus.DRAFT,
      items: [],
    } as never);

    expect(result.status).toBe(InvoiceStatus.FINALIZED);
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'so-1',
        tenant_id: 'tenant-1',
        status: SalesOrderStatus.COMPLETED,
      },
      data: { status: SalesOrderStatus.INVOICED },
    });
  });

  it('returns 409 when invoice status transition is stale', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: null,
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 409 when linked sales order status changed concurrently', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst.mockResolvedValue({
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
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst.mockResolvedValue(null);

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        id: 'inv-1',
        sales_order_id: null,
        status: InvoiceStatus.DRAFT,
        items: [],
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
