import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CustomerType,
  InvoiceStatus,
  Prisma,
  WorkshopOrderStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let service: InvoicesService;

  const tx = {
    invoice: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    workshopOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    invoiceSequence: {
      upsert: jest.fn(),
    },
  };

  const mockPrisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
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

    service = module.get(InvoicesService);
    jest.clearAllMocks();
  });

  const draftInvoice = {
    id: 'inv-1',
    status: InvoiceStatus.DRAFT,
    workshop_order_id: 'wo-1',
    invoice_number: null,
    date: new Date('2026-04-01'),
    due_date: new Date('2026-04-15'),
    total_net: new Prisma.Decimal(100),
    total_tax: new Prisma.Decimal(20),
    total_gross: new Prisma.Decimal(120),
    notes: null,
    tax_mode: null,
    items: [],
    customer: {
      type: CustomerType.PRIVATE,
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      phone: null,
      vat_id: null,
      address_street: null,
      address_city: null,
      address_zip: null,
      address_country: null,
    },
    vehicle: null,
    workshop_order: { id: 'wo-1', status: WorkshopOrderStatus.COMPLETED },
  };

  const vehicle = {
    id: 'vehicle-1',
    make: 'Audi',
    model: 'A4',
    year: 2020,
    engine_code: null,
    vin: 'VIN-1',
    plate: 'PLATE-1',
    identity_resolution_generation: 'generation-1',
    identity_resolution_token: 'token-1',
  };

  it('does not expose identity resolution state from created draft invoice vehicles', async () => {
    tx.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      notes: null,
      status: WorkshopOrderStatus.COMPLETED,
      invoice: null,
      tasks: [
        {
          line_items: [
            {
              description: 'Labor',
              quantity: new Prisma.Decimal(1),
              unit_price: new Prisma.Decimal(100),
            },
          ],
        },
      ],
    });
    tx.invoice.create.mockResolvedValue({
      ...draftInvoice,
      vehicle,
    });

    const result = await service.createDraftInvoice('wo-1');

    expect(result.vehicle).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
  });

  it('does not expose identity resolution state from issued invoice vehicles', async () => {
    const invoiceWithVehicle = { ...draftInvoice, vehicle };
    tx.invoice.findFirst
      .mockResolvedValueOnce(invoiceWithVehicle)
      .mockResolvedValueOnce({
        ...invoiceWithVehicle,
        status: InvoiceStatus.ISSUED,
        invoice_number: 'RE-2026-0001',
      });
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
    tx.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.issueInvoice('inv-1');

    expect(result.vehicle).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
  });

  it('returns 409 when issuing a stale DRAFT invoice', async () => {
    tx.invoice.findFirst.mockResolvedValue(draftInvoice);
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.issueInvoice('inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        status: InvoiceStatus.DRAFT,
      },
      data: { status: InvoiceStatus.ISSUED },
    });
    expect(tx.workshopOrder.updateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when the workshop order is no longer COMPLETED', async () => {
    tx.invoice.findFirst
      .mockResolvedValueOnce(draftInvoice)
      .mockResolvedValueOnce(draftInvoice);
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
    tx.workshopOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.issueInvoice('inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wo-1',
        tenant_id: 'tenant-1',
        status: WorkshopOrderStatus.COMPLETED,
      },
      data: { status: WorkshopOrderStatus.INVOICED },
    });
  });
});
