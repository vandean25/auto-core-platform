import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopCheckInStatus,
  WorkshopMediaPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
import { CHECK_IN_ACKNOWLEDGEMENT_VERSION } from './workshop-check-in-acknowledgement.js';
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
const SIGNATURE_MEDIA_ID = '550e8400-e29b-41d4-a716-446655440099';

function completePayload(expectedRevision: number) {
  return {
    expected_revision: expectedRevision,
    signature_media_id: SIGNATURE_MEDIA_ID,
    signed_by_name: 'Signer Example',
    acknowledgement_version: CHECK_IN_ACKNOWLEDGEMENT_VERSION,
    acknowledgement_locale: 'de' as const,
    acknowledged: true as const,
  };
}

describe('WorkshopCheckInService', () => {
  let service: WorkshopCheckInService;
  const mockMediaStorage = {
    readObjectBytes: jest.fn().mockResolvedValue(Buffer.from('signature-png')),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    mockPrisma.workshopOrder.findFirst.mockReset();
    mockPrisma.workshopCheckIn.findFirst.mockReset();
    mockPrisma.workshopCheckIn.create.mockReset();
    mockPrisma.inspectionTemplate.findFirst.mockReset();
    mockPrisma.workshopInspection.findFirst.mockReset();
    mockPrisma.workshopInspection.create.mockReset();
    mockPrisma.workshopInspectionItem.findMany.mockReset();
    mockPrisma.inspectionTemplate.findFirst.mockResolvedValue(null);
    mockPrisma.workshopInspection.findFirst.mockResolvedValue(null);
    mockPrisma.workshopInspectionItem.findMany.mockResolvedValue([]);
    mockPrisma.workshopCheckIn.updateMany.mockReset();
    mockPrisma.workshopMedia.findMany.mockReset();
    mockPrisma.workshopMedia.findFirst.mockReset();
    mockPrisma.workshopCheckIn.findFirst.mockReset();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockPrisma),
    );
    mockPrisma.$queryRaw.mockImplementation(async (query: unknown) => {
      const sql = String(query);
      if (sql.includes('workshop_check_ins')) {
        return [
          {
            id: CHECK_IN_ID,
            workshop_order_id: ORDER_ID,
            status: WorkshopCheckInStatus.DRAFT,
            inspection_id: null,
          },
        ];
      }
      if (sql.includes('workshop_orders')) {
        return [{ id: ORDER_ID }];
      }
      return [{ id: 'site-1', is_active: true }];
    });
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      role: 'ADMIN',
      userId: 'u-1',
    });
    mockMediaStorage.readObjectBytes.mockResolvedValue(
      Buffer.from('signature-png'),
    );
    mockPrisma.workshopMedia.findFirst.mockResolvedValue({
      id: SIGNATURE_MEDIA_ID,
      storage_bucket: 'bucket',
      storage_key: 'key.png',
      mime_type: 'image/png',
      purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
      check_in_id: CHECK_IN_ID,
      workshop_order_id: ORDER_ID,
    });
    service = new WorkshopCheckInService(
      mockPrisma as never,
      mockTenantContext as never,
      mockSiteContext as never,
      mockMediaStorage as never,
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

  it('does not link an inspection on idempotent create when check-in is completed', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue({
      id: CHECK_IN_ID,
      tenant_id: TENANT_ID,
      workshop_order_id: ORDER_ID,
      inspection_id: null,
      status: WorkshopCheckInStatus.COMPLETED,
      revision: 3,
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
    expect(result.body.inspection_id).toBeNull();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.workshopInspection.create).not.toHaveBeenCalled();
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
      inspection_id: null,
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

  it('rejects completion when signature media is missing', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue({
      id: CHECK_IN_ID,
      status: WorkshopCheckInStatus.DRAFT,
      revision: 2,
    });
    mockPrisma.workshopMedia.findFirst.mockResolvedValue(null);

    await expect(
      service.complete(ORDER_ID, completePayload(2)),
    ).rejects.toMatchObject({
      response: { code: 'CHECK_IN_SIGNATURE_REQUIRED' },
    });
  });

  it('completes without check-in photos when the user has no linked employee', async () => {
    mockPrisma.employee.findFirst.mockReset();
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        status: WorkshopCheckInStatus.DRAFT,
      })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: TENANT_ID,
        workshop_order_id: ORDER_ID,
        status: WorkshopCheckInStatus.DRAFT,
        revision: 2,
        condition_json: {
          schema_version: 1,
          tyre_season: 'WINTER',
          exterior_notes: '',
          interior_notes: '',
        },
        damage_markers_json: [],
        items_left: '',
        key_count: 1,
        warning_lights: [],
        odometer: 1,
        fuel_level: 1,
      })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: TENANT_ID,
        workshop_order_id: ORDER_ID,
        status: WorkshopCheckInStatus.COMPLETED,
        revision: 3,
        condition_json: {},
        damage_markers_json: [],
        items_left: '',
        key_count: 1,
        warning_lights: [],
        odometer: 1,
        fuel_level: 1,
        content_sha256: 'a'.repeat(64),
        completed_at: new Date(),
        completed_by_user_id: 'u-unlinked',
        pdf_sha256: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      role: 'ADMIN',
      userId: 'u-unlinked',
      email: 'unlinked@workshop.at',
    });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([]);
    mockPrisma.workshopCheckIn.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.complete(ORDER_ID, completePayload(2));

    expect(result.status).toBe(WorkshopCheckInStatus.COMPLETED);
    expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('completes a draft atomically and leaves pdf_sha256 unset', async () => {
    const completedAt = new Date('2026-10-17T12:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(completedAt);
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        status: WorkshopCheckInStatus.DRAFT,
      })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: TENANT_ID,
        workshop_order_id: ORDER_ID,
        status: WorkshopCheckInStatus.DRAFT,
        revision: 2,
        condition_json: {
          schema_version: 1,
          tyre_season: 'WINTER',
          exterior_notes: '',
          interior_notes: '',
        },
        damage_markers_json: [],
        items_left: 'umbrella',
        key_count: 1,
        warning_lights: ['ABS'],
        odometer: 125010,
        fuel_level: 38,
      })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: TENANT_ID,
        workshop_order_id: ORDER_ID,
        status: WorkshopCheckInStatus.COMPLETED,
        revision: 3,
        condition_json: {
          schema_version: 1,
          tyre_season: 'WINTER',
          exterior_notes: '',
          interior_notes: '',
        },
        damage_markers_json: [],
        items_left: 'umbrella',
        key_count: 1,
        warning_lights: ['ABS'],
        odometer: 125010,
        fuel_level: 38,
        content_sha256: 'b'.repeat(64),
        completed_at: completedAt,
        completed_by_user_id: 'u-1',
        pdf_sha256: null,
        createdAt: new Date('2026-10-16T10:00:00.000Z'),
        updatedAt: completedAt,
      });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([]);
    mockPrisma.workshopCheckIn.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.complete(
      ORDER_ID,
      completePayload(2),
    );

    expect(result.status).toBe(WorkshopCheckInStatus.COMPLETED);
    expect(result.revision).toBe(3);
    expect(result.content_sha256).toHaveLength(64);
    expect(result.pdf_sha256).toBeNull();
    const updateCall = mockPrisma.workshopCheckIn.updateMany.mock.calls[0]?.[0];
    expect(updateCall?.where).toMatchObject({
      status: WorkshopCheckInStatus.DRAFT,
      revision: 2,
    });
    expect(updateCall?.data).toMatchObject({
      status: WorkshopCheckInStatus.COMPLETED,
      revision: 3,
    });
    expect(updateCall?.data).not.toHaveProperty('pdf_sha256');

    jest.useRealTimers();
  });

  it('rejects completion when the order left intake or in progress inside the transaction', async () => {
    mockPrisma.workshopOrder.findFirst
      .mockResolvedValueOnce({
        id: ORDER_ID,
        status: WorkshopOrderStatus.IN_PROGRESS,
        odometer: 1,
        fuel_level: 1,
      })
      .mockResolvedValueOnce({
        id: ORDER_ID,
        status: WorkshopOrderStatus.INVOICED,
      });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        status: WorkshopCheckInStatus.DRAFT,
      })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        status: WorkshopCheckInStatus.DRAFT,
        revision: 2,
      });

    await expect(
      service.complete(ORDER_ID, completePayload(2)),
    ).rejects.toMatchObject({
      response: { code: 'CHECK_IN_ORDER_STATUS' },
    });
    expect(mockPrisma.workshopCheckIn.updateMany).not.toHaveBeenCalled();
  });

  it('returns the winner frozen record when completion loses the race', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        status: WorkshopCheckInStatus.DRAFT,
      })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: TENANT_ID,
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
      })
      .mockResolvedValueOnce({
        id: CHECK_IN_ID,
        tenant_id: TENANT_ID,
        workshop_order_id: ORDER_ID,
        status: WorkshopCheckInStatus.COMPLETED,
        revision: 3,
        condition_json: {},
        damage_markers_json: [],
        items_left: '',
        key_count: 0,
        warning_lights: [],
        odometer: 1,
        fuel_level: 1,
        content_sha256: 'd'.repeat(64),
        completed_at: new Date('2026-10-17T12:00:00.000Z'),
        completed_by_user_id: 'u-1',
        signed_by_name: 'Signer Example',
        pdf_sha256: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([]);
    mockPrisma.workshopCheckIn.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.complete(
      ORDER_ID,
      completePayload(2),
    );

    expect(result.status).toBe(WorkshopCheckInStatus.COMPLETED);
    expect(result.content_sha256).toBe('d'.repeat(64));
    expect(mockPrisma.workshopCheckIn.updateMany).toHaveBeenCalledTimes(1);
  });

  it('returns the frozen record on idempotent completion retry', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue({
      id: CHECK_IN_ID,
      tenant_id: TENANT_ID,
      workshop_order_id: ORDER_ID,
      status: WorkshopCheckInStatus.COMPLETED,
      revision: 3,
      condition_json: {},
      damage_markers_json: [],
      items_left: '',
      key_count: 0,
      warning_lights: [],
      odometer: 1,
      fuel_level: 1,
      content_sha256: 'c'.repeat(64),
      completed_at: new Date('2026-10-17T12:00:00.000Z'),
      completed_by_user_id: 'u-1',
      signed_by_name: 'Signer Example',
      pdf_sha256: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.complete(ORDER_ID, completePayload(99));

    expect(result.content_sha256).toBe('c'.repeat(64));
    expect(mockPrisma.workshopCheckIn.updateMany).not.toHaveBeenCalled();
  });

  it('rejects idempotent completion when signature evidence differs', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue({
      id: CHECK_IN_ID,
      status: WorkshopCheckInStatus.COMPLETED,
      signed_by_name: 'Signer Example',
    });
    mockPrisma.workshopMedia.findFirst.mockResolvedValue({
      id: 'other-media-id',
      mime_type: 'image/png',
    });

    await expect(
      service.complete(ORDER_ID, completePayload(3)),
    ).rejects.toMatchObject({
      response: { code: 'CHECK_IN_CONFLICT' },
    });
  });

  it('scopes signature media lookup to CHECK_IN_SIGNATURE purpose', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: WorkshopOrderStatus.IN_PROGRESS,
      odometer: 1,
      fuel_level: 1,
    });
    mockPrisma.workshopCheckIn.findFirst.mockResolvedValue({
      id: CHECK_IN_ID,
      status: WorkshopCheckInStatus.DRAFT,
      revision: 2,
    });
    mockPrisma.workshopMedia.findFirst.mockResolvedValue(null);

    await expect(
      service.complete(ORDER_ID, completePayload(2)),
    ).rejects.toMatchObject({
      response: { code: 'CHECK_IN_SIGNATURE_REQUIRED' },
    });

    expect(mockPrisma.workshopMedia.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        id: SIGNATURE_MEDIA_ID,
        check_in_id: CHECK_IN_ID,
        workshop_order_id: ORDER_ID,
        purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
      },
      select: {
        id: true,
        storage_bucket: true,
        storage_key: true,
        mime_type: true,
      },
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
