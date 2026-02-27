import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceStatus,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkshopService } from './workshop.service';

describe('WorkshopService', () => {
  let service: WorkshopService;

  const mockPrisma = {
    workshopOrder: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    workshopTask: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    revenueGroup: {
      findMany: jest.fn(),
    },
    financeSettings: {
      update: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockFinance = {
    validateTransactionDate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FinanceService, useValue: mockFinance },
      ],
    }).compile();

    service = module.get<WorkshopService>(WorkshopService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: any) => any) =>
      cb(mockPrisma),
    );
  });

  it('throws when required revenue groups are missing for direct invoice', async () => {
    mockPrisma.workshopOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.COMPLETED,
      customer_id: 'c-1',
      vehicle_id: 'v-1',
      notes: 'x',
      invoice: null,
      tasks: [
        {
          line_items: [
            {
              type: WorkshopLineItemType.LABOR,
              quantity: 1,
              unit_price: 100,
              description: 'Diag',
            },
          ],
        },
      ],
    });
    mockPrisma.revenueGroup.findMany.mockResolvedValue([]);

    await expect(service.createInvoiceFromOrder('wo-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('creates invoice using configured revenue group names and tax rates', async () => {
    mockFinance.validateTransactionDate.mockResolvedValue(undefined);
    mockPrisma.workshopOrder.findUnique.mockResolvedValue({
      id: 'wo-2',
      status: WorkshopOrderStatus.COMPLETED,
      customer_id: 'c-1',
      vehicle_id: 'v-1',
      notes: 'Workshop note',
      invoice: null,
      tasks: [
        {
          line_items: [
            {
              type: WorkshopLineItemType.LABOR,
              quantity: 2,
              unit_price: 100,
              description: 'Labor line',
            },
            {
              type: WorkshopLineItemType.PART,
              quantity: 1,
              unit_price: 50,
              description: 'Part line',
            },
          ],
        },
      ],
    });
    mockPrisma.revenueGroup.findMany.mockResolvedValue([
      { id: 1, name: 'Services / Labor 20%', tax_rate: 5 },
      { id: 2, name: 'Parts / Goods 20%', tax_rate: 10 },
    ]);
    mockPrisma.financeSettings.update.mockResolvedValue({
      invoice_prefix: 'RE-2026-',
      next_invoice_number: 1002,
    });
    mockPrisma.invoice.create.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
    });

    await service.createInvoiceFromOrder('wo-2');

    const createArgs = mockPrisma.invoice.create.mock.calls[0][0];
    const createdItems = createArgs.data.items.create;
    expect(createdItems[0].revenue_group_name).toBe('Services / Labor 20%');
    expect(Number(createdItems[0].tax_rate)).toBe(5);
    expect(createdItems[1].revenue_group_name).toBe('Parts / Goods 20%');
    expect(Number(createdItems[1].tax_rate)).toBe(10);
    expect(Number(createArgs.data.total_tax)).toBe(15);
  });

  it('derives workshop order status from task updates', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
    });
    mockPrisma.workshopTask.update.mockResolvedValue({});
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
      { status: WorkshopTaskStatus.DONE },
    ]);
    mockPrisma.workshopOrder.update.mockResolvedValue({});
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.updateTask('wo-1', 't-1', { status: WorkshopTaskStatus.DONE });

    expect(mockPrisma.workshopOrder.update).toHaveBeenCalledWith({
      where: { id: 'wo-1' },
      data: { status: WorkshopOrderStatus.COMPLETED },
    });
  });

  it('throws not found when updating missing task', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTask('wo-x', 'task-x', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toThrow(NotFoundException);
  });
});

