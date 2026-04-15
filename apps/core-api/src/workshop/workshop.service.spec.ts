import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
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
      delete: jest.fn(),
      update: jest.fn(),
    },
    workshopTaskLineItem: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
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
      next_workshop_order_number: 2,
    });
    mockPrisma.workshopOrder.create.mockResolvedValue({
      id: 'wo-1',
      order_number: 'WO-2026-0001',
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

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.financeSettings.upsert).toHaveBeenCalled();
    expect(mockPrisma.workshopOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          order_number: 'WO-2026-0001',
        }),
      }),
    );
    expect(result.order_number).toBe('WO-2026-0001');
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
      service.updateTask('wo-1', 't-1', {
        status: WorkshopTaskStatus.NOT_STARTED,
      }),
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

  it('deletes a task and recalculates workshop order status', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.IN_PROGRESS,
        invoice: null,
      },
    });
    mockPrisma.workshopTask.delete.mockResolvedValue({});
    mockPrisma.workshopTask.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await expect(service.deleteTask('wo-1', 't-1')).resolves.toEqual({
      id: 'wo-1',
    });

    expect(mockPrisma.workshopTask.delete).toHaveBeenCalledWith({
      where: { id: 't-1' },
    });
    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'wo-1', status: { not: WorkshopOrderStatus.INVOICED } },
      data: { status: WorkshopOrderStatus.INTAKE },
    });
  });

  it('throws not found when deleting a missing task', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue(null);

    await expect(service.deleteTask('wo-x', 'task-x')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('blocks task deletion when a linked draft invoice exists', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.COMPLETED,
        invoice: { id: 'inv-draft-1', invoice_number: null },
      },
    });

    await expect(service.deleteTask('wo-1', 't-1')).rejects.toThrow(
      BadRequestException,
    );

    expect(mockPrisma.workshopTask.delete).not.toHaveBeenCalled();
  });

  it('persists labor metadata when replacing task line items', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTaskLineItem.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTaskLineItem.createMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.replaceTaskLineItems('wo-1', 't-1', {
      items: [
        {
          type: WorkshopLineItemType.LABOR,
          itemNo: 'LAB-001',
          description: 'Brake labor',
          qty: 1,
          unitPrice: 120,
          laborOperationId: '550e8400-e29b-41d4-a716-446655440000',
          standardAw: 0,
          actualHours: 1.5,
          internalCostRate: 0,
        },
        {
          type: WorkshopLineItemType.PART,
          itemNo: 'PART-001',
          description: 'Pad',
          qty: 1,
          unitPrice: 90,
        },
      ],
    });

    const createManyArg = mockPrisma.workshopTaskLineItem.createMany.mock
      .calls[0]?.[0];
    const firstLineItem = createManyArg?.data?.[0];
    const secondLineItem = createManyArg?.data?.[1];
    expect(createManyArg).toBeDefined();
    expect(firstLineItem).toBeDefined();
    expect(secondLineItem).toBeDefined();
    expect(firstLineItem.labor_operation_id).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(firstLineItem.standard_aw).toEqual(new Prisma.Decimal(0));
    expect(firstLineItem.actual_hours).toEqual(new Prisma.Decimal(1.5));
    expect(firstLineItem.internal_cost_rate).toEqual(new Prisma.Decimal(0));
    expect(secondLineItem.labor_operation_id).toBeNull();
    expect(secondLineItem.standard_aw).toBeNull();
    expect(secondLineItem.actual_hours).toBeNull();
    expect(secondLineItem.internal_cost_rate).toBeNull();
  });

  it('normalizes labor metadata fields in workshop order response', async () => {
    mockPrisma.workshopOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      invoice: null,
      tasks: [
        {
          id: 't-1',
          status: WorkshopTaskStatus.NOT_STARTED,
          line_items: [
            {
              id: 'li-1',
              type: WorkshopLineItemType.LABOR,
              item_no: 'LAB-001',
              description: 'Brake labor',
              quantity: new Prisma.Decimal(1),
              unit_price: new Prisma.Decimal(100),
              labor_operation_id: '550e8400-e29b-41d4-a716-446655440000',
              standard_aw: new Prisma.Decimal(0),
              actual_hours: new Prisma.Decimal(1.25),
              internal_cost_rate: new Prisma.Decimal(0),
            },
            {
              id: 'li-2',
              type: WorkshopLineItemType.PART,
              item_no: 'PART-001',
              description: 'Pad',
              quantity: new Prisma.Decimal(1),
              unit_price: new Prisma.Decimal(90),
              labor_operation_id: null,
              standard_aw: null,
              actual_hours: null,
              internal_cost_rate: null,
            },
          ],
        },
      ],
    });

    const result = await service.findOne('wo-1');
    const lineItem = result.tasks[0].lineItems[0];
    expect(lineItem.laborOperationId).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(lineItem.standardAw).toBe(0);
    expect(lineItem.actualHours).toBe(1.25);
    expect(lineItem.internalCostRate).toBe(0);

    const partLineItem = result.tasks[0].lineItems[1];
    expect(partLineItem.laborOperationId).toBeNull();
    expect(partLineItem.standardAw).toBeNull();
    expect(partLineItem.actualHours).toBeNull();
    expect(partLineItem.internalCostRate).toBeNull();
  });
});
