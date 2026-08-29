import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WorkshopScheduleService } from './workshop-schedule.service';
import { VEHICLE_IDENTITY_RESET } from '../vehicle/vehicle-identity.util';
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
  const rescheduleOrder = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopIntakeService,
        workshopPrismaProvider,
        workshopTenantProvider,
        {
          provide: WorkshopScheduleService,
          useValue: { assertCanBook: jest.fn(), rescheduleOrder },
        },
      ],
    }).compile();

    service = module.get(WorkshopIntakeService);
    resetWorkshopMocks();
    rescheduleOrder.mockReset();
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

  it('clears identity fields when intake changes an existing vehicle plate', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: 'v-1',
        plate: 'OLD-1',
      })
      .mockResolvedValueOnce({
        id: 'v-1',
        vin: 'VIN-1',
        plate: 'NEW-1',
        customer: { id: 'c-1' },
      });
    mockPrisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await service.register({
      customerId: 'c-1',
      vin: 'VIN-1',
      plate: 'NEW-1',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2018,
    });

    expect(mockPrisma.vehicle.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        tenant_id: '00000000-0000-0000-0000-000000000001',
        vin: 'VIN-1',
      },
      select: {
        id: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
    });
    expect(mockPrisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'v-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        vin: 'VIN-1',
        plate: 'OLD-1',
        identity_resolution_generation: null,
        identity_resolution_token: null,
      },
      data: {
        plate: 'NEW-1',
        customer_id: 'c-1',
        ...VEHICLE_IDENTITY_RESET,
        identity_resolution_token: null,
      },
    });
    expect(mockPrisma.vehicle.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'v-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
      },
      include: { customer: true },
    });
  });

  it('does not expose identity resolution state from a registered vehicle response', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue(null);
    mockPrisma.vehicle.create.mockResolvedValue({
      id: 'v-1',
      vin: 'VIN-1',
      plate: 'PL-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
      customer: { id: 'c-1' },
    });

    const result = await service.register({
      customerId: 'c-1',
      vin: 'VIN-1',
      plate: 'PL-1',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2018,
    });

    expect(result).not.toHaveProperty('identity_resolution_generation');
    expect(result).not.toHaveProperty('identity_resolution_token');
  });

  it('does not clear identity fields when intake reuses a vehicle with an equivalent normalized plate', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: 'v-1',
        plate: ' pl-1 ',
      })
      .mockResolvedValueOnce({
        id: 'v-1',
        vin: 'VIN-1',
        plate: 'PL-1',
        customer: { id: 'c-1' },
      });
    mockPrisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await service.register({
      customerId: 'c-1',
      vin: 'VIN-1',
      plate: 'PL-1',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2018,
    });

    const updateData = mockPrisma.vehicle.updateMany.mock.calls[0][0].data;
    expect(updateData).toEqual({
      plate: 'PL-1',
      customer_id: 'c-1',
    });
    for (const resetKey of Object.keys(VEHICLE_IDENTITY_RESET)) {
      expect(updateData).not.toHaveProperty(resetKey);
    }
  });

  it('rejects a stale intake update after identity resolution advances the generation', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: 'v-1',
      plate: 'OLD-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: null,
    });
    mockPrisma.vehicle.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.register({
        customerId: 'c-1',
        vin: 'VIN-1',
        plate: 'NEW-1',
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockPrisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'v-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        vin: 'VIN-1',
        plate: 'OLD-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: null,
      },
      data: expect.objectContaining({
        plate: 'NEW-1',
        customer_id: 'c-1',
        ...VEHICLE_IDENTITY_RESET,
      }),
    });
    expect(mockPrisma.vehicle.upsert).not.toHaveBeenCalled();
  });

  it('canonicalizes the VIN when looking up and creating a registered vehicle', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue(null);
    mockPrisma.vehicle.create.mockResolvedValue({
      id: 'v-1',
      vin: 'VF1ABC123',
      plate: 'PL-1',
      customer: { id: 'c-1' },
    });

    await service.register({
      customerId: 'c-1',
      vin: ' vf1abc123 ',
      plate: 'PL-1',
      make: 'Peugeot',
      model: '308',
      year: 2024,
    });

    expect(mockPrisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: '00000000-0000-0000-0000-000000000001',
        vin: 'VF1ABC123',
      },
      select: {
        id: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
    });
    expect(mockPrisma.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vin: 'VF1ABC123' }),
      }),
    );
    expect(mockPrisma.vehicle.upsert).not.toHaveBeenCalled();
  });

  it('does not expose identity resolution state from a workshop order vehicle', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.workshopOrder.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue(null);
    mockPrisma.financeSettings.upsert.mockResolvedValue({ id: 1 });
    mockPrisma.financeSettings.update.mockResolvedValue({
      next_workshop_order_number: 2,
    });
    mockPrisma.workshopOrder.create.mockResolvedValue({
      id: 'wo-1',
      order_number: 'WO-2026-0001',
      status: WorkshopOrderStatus.INTAKE,
      customer: { id: 'c-1' },
      vehicle: {
        id: 'v-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: 'token-1',
      },
      tasks: [],
    });

    const result = await service.create({
      customerId: 'c-1',
      vehicleId: 'v-1',
      odometer: 10000,
      fuelLevel: 50,
    });

    expect(result.vehicle).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
  });

  it('does not expose identity resolution state from direct or customer-nested search vehicles', async () => {
    mockPrisma.vehicle.findMany.mockResolvedValue([
      {
        id: 'v-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: 'token-1',
        customer: null,
      },
    ]);
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: 'c-1',
        vehicles: [
          {
            id: 'v-2',
            identity_resolution_generation: 'generation-2',
            identity_resolution_token: 'token-2',
          },
        ],
      },
    ]);
    mockPrisma.vehicle.count.mockResolvedValue(1);
    mockPrisma.customer.count.mockResolvedValue(1);

    const result = await service.search('VIN');

    expect(result.data.vehicles[0]).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.data.vehicles[0]).not.toHaveProperty(
      'identity_resolution_token',
    );
    expect(result.data.customers[0].vehicles[0]).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.data.customers[0].vehicles[0]).not.toHaveProperty(
      'identity_resolution_token',
    );
  });

  it('looks up and creates a registered vehicle with a nullable blank VIN', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue(null);
    mockPrisma.vehicle.create.mockResolvedValue({
      id: 'v-1',
      vin: null,
      plate: 'PL-1',
      customer: { id: 'c-1' },
    });

    await service.register({
      customerId: 'c-1',
      vin: '   ',
      plate: 'PL-1',
      make: 'Peugeot',
      model: '308',
      year: 2024,
    });

    expect(mockPrisma.vehicle.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vin: null }),
      }),
    );
  });

  it('creates a new vehicle instead of reusing an existing VIN-less vehicle', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: 'unrelated-v-1',
      vin: null,
      plate: 'OTHER-PLATE',
    });
    mockPrisma.vehicle.create.mockResolvedValue({
      id: 'v-1',
      vin: null,
      plate: 'NEW-PLATE',
      customer: { id: 'c-1' },
    });

    const result = await service.register({
      customerId: 'c-1',
      vin: '   ',
      plate: 'NEW-PLATE',
      make: 'Peugeot',
      model: '308',
      year: 2024,
    });

    expect(mockPrisma.vehicle.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vin: null }),
      }),
    );
    expect(result.id).toBe('v-1');
  });

  it('rejects a concurrent vehicle creation instead of overwriting its intake identity', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue(null);
    mockPrisma.vehicle.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate VIN', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(
      service.register({
        customerId: 'c-1',
        vin: ' vf1abc123 ',
        plate: 'STALE-PLATE',
        make: 'Peugeot',
        model: '308',
        year: 2024,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockPrisma.vehicle.upsert).not.toHaveBeenCalled();
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

  it('reschedules within a transaction when schedule fields are patched', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.SCHEDULED,
      vehicle_id: 'v-1',
      bay_id: 'bay-1',
      mechanic_id: null,
      scheduled_start_at: new Date('2026-08-21T08:00:00.000Z'),
      scheduled_end_at: new Date('2026-08-21T09:00:00.000Z'),
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      invoice: null,
      tasks: [],
    });

    rescheduleOrder.mockResolvedValue({
      bayId: 'bay-1',
      mechanicId: null,
      start: new Date('2026-08-21T10:00:00.000Z'),
      end: new Date('2026-08-21T11:00:00.000Z'),
    });

    mockPrisma.workshopOrder.update.mockResolvedValue({
      id: 'wo-1',
      order_number: 'WO-2026-0001',
      status: WorkshopOrderStatus.SCHEDULED,
      bay_id: 'bay-1',
      mechanic_id: null,
      scheduled_start_at: new Date('2026-08-21T10:00:00.000Z'),
      scheduled_end_at: new Date('2026-08-21T11:00:00.000Z'),
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      invoice: null,
      tasks: [],
    });

    await service.updateOrder('wo-1', {
      scheduledStartAt: '2026-08-21T10:00:00.000Z',
      scheduledEndAt: '2026-08-21T11:00:00.000Z',
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(rescheduleOrder).toHaveBeenCalledWith(
      'wo-1',
      expect.objectContaining({ vehicle_id: 'v-1', bay_id: 'bay-1' }),
      expect.objectContaining({
        scheduledStartAt: '2026-08-21T10:00:00.000Z',
        scheduledEndAt: '2026-08-21T11:00:00.000Z',
      }),
      expect.anything(),
    );
    expect(mockPrisma.workshopOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduled_start_at: new Date('2026-08-21T10:00:00.000Z'),
          scheduled_end_at: new Date('2026-08-21T11:00:00.000Z'),
        }),
      }),
    );
  });
});
