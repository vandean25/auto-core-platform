import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, SalesOrderStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from './sales.service';

describe('SalesService', () => {
  let service: SalesService;

  const tx = {
    invoiceSequence: {
      upsert: jest.fn().mockResolvedValue({ current: 1 }),
    },
    inventoryStock: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
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

  const mockPrisma = {
    invoice: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: FinanceService,
          useValue: { validateTransactionDate: jest.fn() },
        },
        {
          provide: TenantContextService,
          useValue: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
        },
      ],
    }).compile();

    service = module.get(SalesService);
    jest.clearAllMocks();
    tx.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
  });

  it('returns 409 when finalizing a stale DRAFT invoice', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      date: new Date('2026-04-01'),
      items: [],
      sales_order_id: null,
    });
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.finalize('inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        status: InvoiceStatus.DRAFT,
      },
      data: expect.objectContaining({ status: InvoiceStatus.FINALIZED }),
    });
  });

  it('returns 409 when the linked sales order status changed concurrently', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      date: new Date('2026-04-01'),
      items: [],
      sales_order_id: 'so-1',
    });
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

    await expect(service.finalize('inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'so-1',
        tenant_id: 'tenant-1',
        status: SalesOrderStatus.COMPLETED,
      },
      data: { status: SalesOrderStatus.INVOICED },
    });
  });
});
