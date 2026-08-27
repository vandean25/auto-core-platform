import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WorkshopScheduleService } from './workshop-schedule.service';
import {
  mockPrisma,
  resetWorkshopMocks,
  workshopPrismaProvider,
  workshopTenantProvider,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from './workshop.spec.support';

describe('WorkshopIntakeService', () => {
  let service: WorkshopIntakeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopIntakeService,
        workshopPrismaProvider,
        workshopTenantProvider,
        {
          provide: WorkshopScheduleService,
          useValue: { assertCanBook: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(WorkshopIntakeService);
    resetWorkshopMocks();
  });
  it('creates workshop order with generated order number', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
    mockPrisma.workshopOrder.findMany.mockResolvedValue([]);
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

  it('promotes the closest scheduled order instead of minting a new number', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
    mockPrisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-scheduled',
        scheduled_start_at: new Date('2026-08-21T10:00:00.000Z'),
      },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-scheduled',
      order_number: 'WO-2026-0042',
      status: WorkshopOrderStatus.INTAKE,
      odometer: 12000,
      fuel_level: 60,
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      tasks: [],
    });

    const result = await service.create({
      customerId: 'c-1',
      vehicleId: 'v-1',
      odometer: 12000,
      fuelLevel: 60,
      reportedIssue: 'Brake noise',
    });

    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wo-scheduled',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        status: WorkshopOrderStatus.SCHEDULED,
      },
      data: {
        status: WorkshopOrderStatus.INTAKE,
        odometer: 12000,
        fuel_level: 60,
        reported_issue: 'Brake noise',
        notes: undefined,
      },
    });
    expect(mockPrisma.financeSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.workshopOrder.create).not.toHaveBeenCalled();
    expect(result.order_number).toBe('WO-2026-0042');
    expect(result.status).toBe(WorkshopOrderStatus.INTAKE);
  });

  it('picks the scheduled order closest to now when several exist', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
    const now = Date.now();
    mockPrisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-far',
        scheduled_start_at: new Date(now + 24 * 60 * 60 * 1000),
      },
      {
        id: 'wo-close',
        scheduled_start_at: new Date(now + 30 * 60 * 1000),
      },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-close',
      order_number: 'WO-2026-0043',
      status: WorkshopOrderStatus.INTAKE,
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      tasks: [],
    });

    await service.create({
      customerId: 'c-1',
      vehicleId: 'v-1',
      odometer: 10000,
      fuelLevel: 50,
    });

    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'wo-close' }),
      }),
    );
  });

  it('rejects a second active order on the same vehicle', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
    mockPrisma.workshopOrder.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-live',
      order_number: 'WO-2026-0007',
    });

    await expect(
      service.create({
        customerId: 'c-1',
        vehicleId: 'v-1',
        odometer: 10000,
        fuelLevel: 50,
      }),
    ).rejects.toMatchObject({
      message: 'Vehicle already has active order WO-2026-0007',
    });
    expect(mockPrisma.workshopOrder.create).not.toHaveBeenCalled();
  });

  it('rejects concurrent promote when another request already moved the order', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
    mockPrisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-scheduled',
        scheduled_start_at: new Date('2026-08-21T10:00:00.000Z'),
      },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-scheduled',
      order_number: 'WO-2026-0042',
    });

    await expect(
      service.create({
        customerId: 'c-1',
        vehicleId: 'v-1',
        odometer: 12000,
        fuelLevel: 60,
      }),
    ).rejects.toMatchObject({
      message: 'Vehicle already has active order WO-2026-0042',
    });
    expect(mockPrisma.workshopOrder.create).not.toHaveBeenCalled();
  });

  it('normalizes labor metadata fields in workshop order response', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
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
              part_execution_status: null,
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
              part_execution_status:
                WorkshopPartLineExecutionStatus.PENDING_PICK,
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
    expect(partLineItem.partExecutionStatus).toBe(
      WorkshopPartLineExecutionStatus.PENDING_PICK,
    );
  });
});
