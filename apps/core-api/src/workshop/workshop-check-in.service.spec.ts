import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkshopCheckInStatus, WorkshopOrderStatus } from '@prisma/client';
import { WorkshopCheckInService } from './workshop-check-in.service.js';
import {
  mockPrisma,
  mockSiteContext,
  mockTenantContext,
} from './workshop.spec.support.js';

const ORDER_ID = '550e8400-e29b-41d4-a716-446655440010';
const CHECK_IN_ID = '550e8400-e29b-41d4-a716-446655440011';

describe('WorkshopCheckInService', () => {
  let service: WorkshopCheckInService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.workshopOrder.findFirst.mockReset();
    mockPrisma.workshopCheckIn.findFirst.mockReset();
    mockPrisma.workshopCheckIn.create.mockReset();
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      role: 'ADMIN',
      userId: 'u-1',
    });
    service = new WorkshopCheckInService(
      mockPrisma as never,
      mockTenantContext as never,
      mockSiteContext as never,
    );
  });

  it('creates a draft check-in with order mileage snapshot', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.INTAKE,
      odometer: 42000,
      fuel_level: 55,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue(null);
    mockPrisma.workshopCheckIn.create.mockResolvedValue({
      id: CHECK_IN_ID,
      tenant_id: 'tenant-1',
      workshop_order_id: ORDER_ID,
      status: WorkshopCheckInStatus.DRAFT,
      revision: 1,
      condition_json: {},
      damage_markers_json: [],
      items_left: '',
      key_count: 0,
      warning_lights: [],
      odometer: 42000,
      fuel_level: 55,
      createdAt: new Date('2026-10-16T10:00:00.000Z'),
      updatedAt: new Date('2026-10-16T10:00:00.000Z'),
    });

    const result = await service.create(ORDER_ID, { id: CHECK_IN_ID });

    expect(result.odometer).toBe(42000);
    expect(mockPrisma.workshopCheckIn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: CHECK_IN_ID,
          workshop_order_id: ORDER_ID,
          odometer: 42000,
          fuel_level: 55,
        }),
      }),
    );
  });

  it('rejects create when order status is not intake or in progress', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.COMPLETED,
      odometer: 1,
      fuel_level: 1,
    });

    await expect(
      service.create(ORDER_ID, { id: CHECK_IN_ID }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('returns existing draft on idempotent create retry', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.INTAKE,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: 'tenant-1',
        workshop_order_id: ORDER_ID,
        status: WorkshopCheckInStatus.DRAFT,
        revision: 1,
        condition_json: {},
        damage_markers_json: [],
        items_left: '',
        key_count: 0,
        warning_lights: [],
        odometer: 1,
        fuel_level: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce(null);

    const result = await service.create(ORDER_ID, { id: CHECK_IN_ID });

    expect(result.id).toBe(CHECK_IN_ID);
    expect(mockPrisma.workshopCheckIn.create).not.toHaveBeenCalled();
  });

  it('rejects stale revision on draft update', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue({
      id: CHECK_IN_ID,
      tenant_id: 'tenant-1',
      workshop_order_id: ORDER_ID,
      status: WorkshopCheckInStatus.DRAFT,
      revision: 2,
      condition_json: {},
      damage_markers_json: [],
      items_left: '',
      key_count: 0,
      warning_lights: [],
      odometer: 1,
      fuel_level: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.updateDraft(ORDER_ID, { expected_revision: 1, items_left: 'pilot customer jacket' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 when check-in is missing', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.INTAKE,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue(null);

    await expect(service.get(ORDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
