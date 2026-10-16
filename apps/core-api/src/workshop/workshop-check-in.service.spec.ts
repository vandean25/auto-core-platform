import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopCheckInStatus, WorkshopOrderStatus } from '@prisma/client';
import { WorkshopCheckInService } from './workshop-check-in.service.js';
import {
  mockPrisma,
  mockSiteContext,
  mockTenantContext,
} from './workshop.spec.support.js';

const ORDER_ID = '550e8400-e29b-41d4-a716-446655440010';
const CHECK_IN_ID = '550e8400-e29b-41d4-a716-446655440011';
const MARKER_ID = '550e8400-e29b-41d4-a716-446655440012';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('WorkshopCheckInService', () => {
  let service: WorkshopCheckInService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.workshopOrder.findFirst.mockReset();
    mockPrisma.workshopCheckIn.findFirst.mockReset();
    mockPrisma.workshopCheckIn.create.mockReset();
    mockPrisma.workshopCheckIn.updateMany.mockReset();
    mockPrisma.workshopMedia.findMany.mockReset();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 'site-1', is_active: true },
    ]);
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
      tenant_id: TENANT_ID,
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

    expect(result.created).toBe(true);
    expect(result.body.odometer).toBe(42000);
    expect(mockPrisma.workshopCheckIn.create).toHaveBeenCalled();
  });

  it('maps concurrent create unique violations to CHECK_IN_EXISTS', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.INTAKE,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'other-check-in',
        tenant_id: TENANT_ID,
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
      });
    mockPrisma.workshopCheckIn.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.0.0',
      }),
    );

    await expect(service.create(ORDER_ID, { id: CHECK_IN_ID })).rejects.toMatchObject({
      response: { code: 'CHECK_IN_EXISTS' },
    });
  });

  it('returns created false on idempotent create retry', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.INTAKE,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue({
      id: CHECK_IN_ID,
      tenant_id: TENANT_ID,
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
    });

    const result = await service.create(ORDER_ID, { id: CHECK_IN_ID });
    expect(result.created).toBe(false);
    expect(result.body.id).toBe(CHECK_IN_ID);
    expect(mockPrisma.workshopCheckIn.create).not.toHaveBeenCalled();
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

  it('updates draft only when tenant, order, revision and DRAFT match', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({ id: CHECK_IN_ID })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: TENANT_ID,
        workshop_order_id: ORDER_ID,
        status: WorkshopCheckInStatus.DRAFT,
        revision: 2,
        condition_json: {},
        damage_markers_json: [],
        items_left: 'pilot customer jacket',
        key_count: 0,
        warning_lights: [],
        odometer: 1,
        fuel_level: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    mockPrisma.workshopCheckIn.updateMany.mockResolvedValue({ count: 1 });

    await service.updateDraft(ORDER_ID, {
      expected_revision: 1,
      items_left: 'pilot customer jacket',
    });

    expect(mockPrisma.workshopCheckIn.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: TENANT_ID,
          workshop_order_id: ORDER_ID,
          revision: 1,
          status: WorkshopCheckInStatus.DRAFT,
        },
      }),
    );
    expect(mockPrisma.workshopCheckIn.findFirst).toHaveBeenLastCalledWith({
      where: {
        tenant_id: TENANT_ID,
        workshop_order_id: ORDER_ID,
        revision: 2,
      },
    });
  });

  it('rejects stale revision on draft update with CHECK_IN_CONFLICT', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({ id: CHECK_IN_ID })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        status: WorkshopCheckInStatus.DRAFT,
        revision: 2,
      });
    mockPrisma.workshopCheckIn.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateDraft(ORDER_ID, {
        expected_revision: 1,
        items_left: 'pilot customer jacket',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CHECK_IN_CONFLICT' },
    });
  });

  it('rejects update when check-in is completed', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({ id: CHECK_IN_ID })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        status: WorkshopCheckInStatus.COMPLETED,
        revision: 3,
      });
    mockPrisma.workshopCheckIn.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateDraft(ORDER_ID, { expected_revision: 3, items_left: 'x' }),
    ).rejects.toMatchObject({
      response: { code: 'CHECK_IN_COMPLETED' },
    });
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
