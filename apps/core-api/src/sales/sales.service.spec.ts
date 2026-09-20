import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, SalesOrderStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { AtpService } from '../inventory/atp.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SalesService } from './sales.service.js';
import { InvoiceFinalizationService } from './invoice-finalization.service.js';
import { InvoiceSnapshotCommitService } from '../invoices/invoice-snapshot-commit.service.js';

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
        {
          provide: AtpService,
          useValue: {
            calculateAtp: jest.fn(),
            deductOnHandForSale: jest.fn(),
          },
        },
        {
          provide: SiteContextService,
          useValue: { getSiteId: jest.fn().mockResolvedValue('site-1') },
        },
        InvoiceFinalizationService,
        {
          provide: InvoiceSnapshotCommitService,
          useValue: {
            prepareV2Snapshot: jest.fn().mockResolvedValue({
              snapshot: { schema_version: 2 },
              ownership: { siteId: 'site-1', legalEntityId: 'le-1' },
              dueDate: new Date(),
              supplyFrom: new Date(),
              supplyTo: new Date(),
            }),
            persistV2Snapshot: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(SalesService);
    jest.clearAllMocks();
    tx.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
  });

  it('does not expose identity resolution state from invoice detail vehicles', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'invoice-1',
      vehicle: {
        id: 'vehicle-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: 'token-1',
      },
    });

    const result = await service.findOne('invoice-1');

    expect(result.vehicle).not.toHaveProperty('identity_resolution_generation');
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
  });

  it('returns 409 when finalizing a stale DRAFT invoice', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      date: new Date('2026-04-01'),
      items: [],
      sales_order_id: 'so-1',
      workshop_order_id: null,
      vehicle_sale_id: null,
    });
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      date: new Date('2026-04-01'),
      items: [],
      customer: { id: 'customer-1' },
      vehicle: null,
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
      workshop_order_id: null,
      vehicle_sale_id: null,
    });
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.DRAFT,
        date: new Date('2026-04-01'),
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

    await expect(service.finalize('inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
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
});
