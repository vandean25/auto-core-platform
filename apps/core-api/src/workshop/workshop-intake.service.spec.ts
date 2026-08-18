import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopIntakeService } from './workshop-intake.service';
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
      ],
    }).compile();

    service = module.get(WorkshopIntakeService);
    resetWorkshopMocks();
  });
  it('creates workshop order with generated order number', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
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
