import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WorkshopScheduleService } from './workshop-schedule.service';
import { WorkshopTaskService } from './workshop-task.service';
import {
  mockPrisma,
  resetWorkshopMocks,
  workshopPrismaProvider,
  workshopTenantProvider,
  workshopVehicleLedgerProvider,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from './workshop.spec.support';

describe('WorkshopTaskService', () => {
  let service: WorkshopTaskService;
  let orders: WorkshopIntakeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopTaskService,
        WorkshopIntakeService,
        workshopPrismaProvider,
        workshopTenantProvider,
        workshopVehicleLedgerProvider,
        { provide: WorkshopScheduleService, useValue: { assertCanBook: jest.fn() } },
      ],
    }).compile();

    service = module.get(WorkshopTaskService);
    orders = module.get(WorkshopIntakeService);
    resetWorkshopMocks();
  });
  it('derives workshop order status from task updates', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      status: WorkshopTaskStatus.IN_PROGRESS,
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
      { status: WorkshopTaskStatus.DONE },
    ]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      status: WorkshopOrderStatus.IN_PROGRESS,
    });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(orders, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.updateTask('wo-1', 't-1', {
      status: WorkshopTaskStatus.DONE,
    });

    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wo-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        status: WorkshopOrderStatus.IN_PROGRESS,
      },
      data: { status: WorkshopOrderStatus.COMPLETED },
    });
  });

  it('throws not found when updating missing task', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTask('wo-x', 'task-x', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 409 when a task status transition loses the expected-from race', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      status: WorkshopTaskStatus.IN_PROGRESS,
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateTask('wo-1', 't-1', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith({
      where: {
        workshop_order_id: 'wo-1',
        id: 't-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        status: WorkshopTaskStatus.IN_PROGRESS,
      },
      data: { status: WorkshopTaskStatus.DONE },
    });
    expect(mockPrisma.workshopOrder.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the task write when a concurrent derived order update already reached the next status', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      status: WorkshopTaskStatus.NOT_STARTED,
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.INTAKE },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.IN_PROGRESS },
      { status: WorkshopTaskStatus.NOT_STARTED },
    ]);
    mockPrisma.workshopOrder.findFirst
      .mockResolvedValueOnce({ status: WorkshopOrderStatus.INTAKE })
      .mockResolvedValueOnce({ status: WorkshopOrderStatus.IN_PROGRESS });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 0 });
    jest.spyOn(orders, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await expect(
      service.updateTask('wo-1', 't-1', {
        status: WorkshopTaskStatus.IN_PROGRESS,
      }),
    ).resolves.toEqual({ id: 'wo-1' });
  });

  it('returns 409 when a derived order CAS loses to a different status', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      status: WorkshopTaskStatus.IN_PROGRESS,
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
    ]);
    mockPrisma.workshopOrder.findFirst
      .mockResolvedValueOnce({ status: WorkshopOrderStatus.IN_PROGRESS })
      .mockResolvedValueOnce({ status: WorkshopOrderStatus.INTAKE });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateTask('wo-1', 't-1', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not write status when updating only mechanic notes', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      status: WorkshopTaskStatus.IN_PROGRESS,
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.IN_PROGRESS },
    ]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      status: WorkshopOrderStatus.IN_PROGRESS,
    });
    jest.spyOn(orders, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.updateTask('wo-1', 't-1', {
      mechanicNotes: 'Waiting on parts',
    });

    const updateArgs = mockPrisma.workshopTask.updateMany.mock.calls[0][0];
    expect(updateArgs.data).toEqual({ mechanic_notes: 'Waiting on parts' });
    expect(updateArgs.data).not.toHaveProperty('status');
    expect(mockPrisma.workshopOrder.updateMany).not.toHaveBeenCalled();
  });

  it('allows task updates for completed orders even when draft invoice exists', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      status: WorkshopTaskStatus.DONE,
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.COMPLETED,
        invoice: { id: 'inv-draft-1', invoice_number: null },
      },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
      { status: WorkshopTaskStatus.NOT_STARTED },
    ]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      status: WorkshopOrderStatus.COMPLETED,
    });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(orders, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await expect(
      service.updateTask('wo-1', 't-1', {
        status: WorkshopTaskStatus.NOT_STARTED,
      }),
    ).resolves.toEqual({ id: 'wo-1' });

    expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalled();
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

    expect(mockPrisma.workshopTask.updateMany).not.toHaveBeenCalled();
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
    mockPrisma.workshopTask.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      status: WorkshopOrderStatus.IN_PROGRESS,
    });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(orders, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await expect(service.deleteTask('wo-1', 't-1')).resolves.toEqual({
      id: 'wo-1',
    });

    expect(mockPrisma.workshopTask.deleteMany).toHaveBeenCalledWith({
      where: { id: 't-1', tenant_id: '00000000-0000-0000-0000-000000000001' },
    });
    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wo-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        status: WorkshopOrderStatus.IN_PROGRESS,
      },
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
      line_items_version: 0,
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTaskLineItem.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTaskLineItem.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.laborOperation.count.mockResolvedValue(1);
    jest.spyOn(orders, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.replaceTaskLineItems('wo-1', 't-1', {
      version: 0,
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

    const createManyArg =
      mockPrisma.workshopTaskLineItem.createMany.mock.calls[0]?.[0];
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
    expect(secondLineItem.part_execution_status).toBe(
      WorkshopPartLineExecutionStatus.PENDING_PICK,
    );
  });

  it('rejects a line-item patch when the task version is stale', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      line_items_version: 4,
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.replaceTaskLineItems('wo-1', 't-1', {
        version: 3,
        items: [],
      } as any),
    ).rejects.toThrow(ConflictException);

    expect(mockPrisma.workshopTaskLineItem.deleteMany).not.toHaveBeenCalled();
  });

  it('patches existing line items by id and increments the task version', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      line_items_version: 3,
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      { id: 'line-1' },
      { id: 'line-2' },
    ]);
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTaskLineItem.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTaskLineItem.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTaskLineItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.laborOperation.count.mockResolvedValue(0);
    jest.spyOn(orders, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.replaceTaskLineItems('wo-1', 't-1', {
      version: 3,
      items: [
        { id: 'line-1', type: WorkshopLineItemType.PART, itemNo: 'P-1', description: 'Pad', qty: 2, unitPrice: 10 },
        { type: WorkshopLineItemType.PART, itemNo: 'P-2', description: 'Disc', qty: 1, unitPrice: 20 },
      ],
    } as any);

    expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', tenant_id: '00000000-0000-0000-0000-000000000001', line_items_version: 3 },
      data: { line_items_version: { increment: 1 } },
    });
    expect(mockPrisma.workshopTaskLineItem.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: '00000000-0000-0000-0000-000000000001', workshop_task_id: 't-1', id: { in: ['line-2'] } },
    });
    expect(mockPrisma.workshopTaskLineItem.updateMany).toHaveBeenCalled();
    expect(mockPrisma.workshopTaskLineItem.createMany).toHaveBeenCalled();
  });

  it('returns a bad request error for invalid laborOperationId', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      line_items_version: 0,
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTaskLineItem.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.laborOperation.count.mockResolvedValue(0); // Simulate missing/wrong tenant ID

    await expect(
      service.replaceTaskLineItems('wo-1', 't-1', {
        version: 0,
        items: [
          {
            type: WorkshopLineItemType.LABOR,
            itemNo: 'LAB-INVALID',
            description: 'Invalid labor reference',
            qty: 1,
            unitPrice: 100,
            laborOperationId: '00000000-0000-0000-0000-000000000001',
            standardAw: 1,
            actualHours: 1,
            internalCostRate: 50,
          },
        ],
      }),
    ).rejects.toThrow(
      'Invalid laborOperationId: one or more labor operations were not found within this tenant scope',
    );
  });

  it('defaults the first task scheduled_date from the order booking date', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.INTAKE,
      scheduled_start_at: new Date('2026-08-21T08:30:00.000Z'),
      tasks: [],
      invoice: null,
    });
    mockPrisma.workshopSettings.findFirst.mockResolvedValue({
      timezone: 'Europe/Vienna',
    });
    mockPrisma.workshopTask.create.mockResolvedValue({
      id: 't-1',
      status: WorkshopTaskStatus.NOT_STARTED,
      scheduled_date: new Date('2026-08-21T00:00:00.000Z'),
      line_items: [],
    });

    await service.createTask('wo-1', { title: 'Brake service' });

    expect(mockPrisma.workshopTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduled_date: new Date('2026-08-21T00:00:00.000Z'),
        }),
      }),
    );
  });
});
