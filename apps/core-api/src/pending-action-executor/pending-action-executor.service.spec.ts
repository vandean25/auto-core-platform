import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PendingActionExecutorService } from './pending-action-executor.service.js';

describe('PendingActionExecutorService', () => {
  const mockPrisma = {
    site: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    workshopOrder: { findFirst: jest.fn() },
    workshopTask: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000006',
        line_items_version: 0,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopTaskLineItem: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'line-item-1' }),
    },
    partsReservation: { findFirst: jest.fn() },
  };
  const mockTenant = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
  const mockSite = { getSiteId: jest.fn().mockResolvedValue('site-1') };
  const mockWorkshop = {
    create: jest.fn().mockResolvedValue({ id: 'order-1' }),
    createAtSite: jest.fn().mockResolvedValue({ id: 'order-1' }),
  };
  const mockParts = {
    createOnHandReservation: jest
      .fn()
      .mockResolvedValue({ id: 'reservation-1' }),
    releaseReservation: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
  };

  let service: PendingActionExecutorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PendingActionExecutorService(
      mockPrisma as never,
      mockTenant as never,
      mockSite as never,
      mockWorkshop as never,
      mockParts as never,
    );
  });

  it('resolves workshop order creation to the current workshop operation', async () => {
    const executor = service.resolve('workshop_order.create');
    await executor.execute(
      {
        customer_id: '00000000-0000-4000-8000-000000000001',
        vehicle_id: '00000000-0000-4000-8000-000000000002',
        purpose: 'CUSTOMER_REPAIR',
        status: 'SCHEDULED',
      },
      { site_id: 'site-1' },
    );
    expect(executor.actionType).toBe('workshop_order.create');
    expect(mockWorkshop.createAtSite).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '00000000-0000-4000-8000-000000000001',
        purpose: 'CUSTOMER_REPAIR',
      }),
      'site-1',
    );
  });

  it('builds reservation policy context from tenant and active site data', async () => {
    mockPrisma.workshopTaskLineItem.findFirst.mockResolvedValue({
      unit_price: new Prisma.Decimal(25),
    });
    const executor = service.resolve('workshop_task.reserve_part');
    await executor.buildPolicyContext({
      workshop_task_line_item_id: '00000000-0000-4000-8000-000000000003',
      quantity: 1,
    });
    expect(mockTenant.getTenantId).toHaveBeenCalled();
    expect(mockSite.getSiteId).toHaveBeenCalled();
    expect(mockPrisma.workshopTaskLineItem.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000003',
        tenant_id: 'tenant-1',
        workshop_task: { workshop_order: { site_id: 'site-1' } },
      }),
      select: { unit_price: true },
    });
  });

  it('keeps reservation release on the existing inventory policy action key', () => {
    expect(service.resolve('inventory.part_release').actionType).toBe(
      'inventory.part_release',
    );
  });

  it('keeps reservation creation on the existing inventory policy action key', () => {
    expect(service.resolve('inventory.part_reserve').actionType).toBe(
      'inventory.part_reserve',
    );
  });

  it.each([
    { quantity: -1, unit_price_cents: 100 },
    { quantity: 1, unit_price_cents: -100 },
  ])(
    'rejects invalid proposed line financials before policy evaluation',
    async (line) => {
      const executor = service.resolve('workshop_order.propose_line');

      expect(() =>
        executor.buildPolicyContext({
          workshop_order_id: '00000000-0000-4000-8000-000000000007',
          workshop_task_id: '00000000-0000-4000-8000-000000000006',
          expected_line_items_version: 0,
          line_item: {
            type: 'PART',
            item_no: 'FABRICATED-PART-1',
            description: 'Fabricated test part',
            ...line,
          },
        }),
      ).toThrow(BadRequestException);
    },
  );

  it('resolves part reservation and release operations', async () => {
    await service.resolve('workshop_task.reserve_part').execute({
      workshop_task_line_item_id: '00000000-0000-4000-8000-000000000003',
      quantity: 2,
      location_id: '00000000-0000-4000-8000-000000000004',
    });
    await service.resolve('workshop_task.release_reservation').execute({
      reservation_id: '00000000-0000-4000-8000-000000000005',
    });
    expect(mockParts.createOnHandReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        workshopTaskLineItemId: '00000000-0000-4000-8000-000000000003',
        quantity: 2,
      }),
    );
    expect(mockParts.releaseReservation).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000005',
      {},
    );
  });

  it('executes a line-item action with tenant, site, and version scoping', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000007',
      status: 'IN_PROGRESS',
      purpose: 'CUSTOMER_REPAIR',
      tasks: [
        { id: '00000000-0000-4000-8000-000000000006', line_items_version: 0 },
      ],
    });
    const executor = service.resolve('workshop_order.propose_line');
    await executor.execute({
      workshop_order_id: '00000000-0000-4000-8000-000000000007',
      workshop_task_id: '00000000-0000-4000-8000-000000000006',
      expected_line_items_version: 0,
      line_item: {
        type: 'PART',
        item_no: 'TEST-1',
        description: 'Fabricated brake check',
        quantity: 1,
        unit_price_cents: 1500,
      },
    });
    expect(mockPrisma.workshopOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: '00000000-0000-4000-8000-000000000007',
          tenant_id: 'tenant-1',
          site_id: 'site-1',
        },
        include: expect.objectContaining({
          tasks: expect.objectContaining({
            where: expect.objectContaining({
              tenant_id: 'tenant-1',
              workshop_order: { tenant_id: 'tenant-1', site_id: 'site-1' },
            }),
          }),
        }),
      }),
    );
    expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000006',
          tenant_id: 'tenant-1',
          line_items_version: 0,
        }),
      }),
    );
    expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledTimes(1);
  });

  it('refuses unknown action keys', () => {
    expect(() => service.resolve('workshop_order.delete')).toThrow(
      BadRequestException,
    );
  });
});
