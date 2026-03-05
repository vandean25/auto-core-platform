import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopOrderStatus, WorkshopTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkshopService } from './workshop.service';
import { InvoicesService } from '../invoices/invoices.service';

describe('WorkshopService', () => {
  let service: WorkshopService;

  const mockPrisma = {
    financeSettings: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    customer: {
      findUnique: jest.fn(),
    },
    vehicle: {
      findUnique: jest.fn(),
    },
    workshopOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    workshopTask: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockInvoices = {
    createDraftInvoice: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoicesService, useValue: mockInvoices },
      ],
    }).compile();

    service = module.get<WorkshopService>(WorkshopService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: any) => any) =>
      cb(mockPrisma),
    );
  });

  it('delegates invoice creation to InvoicesService', async () => {
    mockInvoices.createDraftInvoice.mockResolvedValue({ id: 'inv-1' });

    await service.createInvoiceFromOrder('wo-1');

    expect(mockInvoices.createDraftInvoice).toHaveBeenCalledWith('wo-1');
  });

  it('creates workshop order with generated order number', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findUnique.mockResolvedValue({ id: 'v-1' });
    mockPrisma.financeSettings.upsert.mockResolvedValue({ id: 1 });
    mockPrisma.financeSettings.update.mockResolvedValue({
      workshop_order_prefix: 'WO-2026-',
      next_workshop_order_number: 1002,
    });
    mockPrisma.workshopOrder.create.mockResolvedValue({
      id: 'wo-1',
      order_number: 'WO-2026-1001',
      status: WorkshopOrderStatus.INTAKE,
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      tasks: [],
    });

    const result = await service.create({
      customerId: 'c-1',
      vehicleId: 'v-1',
      odometer: 10000,
      fuelLevel: 50,
      notes: 'Noise check',
    });

    expect(mockPrisma.workshopOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          order_number: 'WO-2026-1001',
        }),
      }),
    );
    expect(result.order_number).toBe('WO-2026-1001');
  });

  it('derives workshop order status from task updates', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTask.update.mockResolvedValue({});
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
      { status: WorkshopTaskStatus.DONE },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.updateTask('wo-1', 't-1', {
      status: WorkshopTaskStatus.DONE,
    });

    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'wo-1', status: { not: WorkshopOrderStatus.INVOICED } },
      data: { status: WorkshopOrderStatus.COMPLETED },
    });
  });

  it('throws not found when updating missing task', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTask('wo-x', 'task-x', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows task updates for completed orders even when draft invoice exists', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.COMPLETED,
        invoice: { id: 'inv-draft-1', invoice_number: null },
      },
    });
    mockPrisma.workshopTask.update.mockResolvedValue({});
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
      { status: WorkshopTaskStatus.NOT_STARTED },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await expect(
      service.updateTask('wo-1', 't-1', { status: WorkshopTaskStatus.NOT_STARTED }),
    ).resolves.toEqual({ id: 'wo-1' });

    expect(mockPrisma.workshopTask.update).toHaveBeenCalled();
  });

  it('blocks updates when workshop order status is invoiced', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.INVOICED,
        invoice: { id: 'inv-1', invoice_number: 'RE-2026-0001' },
      },
    });

    await expect(
      service.updateTask('wo-1', 't-1', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.workshopTask.update).not.toHaveBeenCalled();
  });
});
