import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkshopMediaUrlStrategy, WorkshopTaskStatus } from '@prisma/client';
import { MechanicMediaService } from './mechanic-media.service';
import {
  MECHANIC_ID,
  ORDER_ID,
  TASK_ID,
  TENANT_ID,
  mockMediaStorage,
  mockPrisma,
  mockRealtimeService,
  mockTenantContext,
} from './mechanic.spec.support';

describe('MechanicMediaService', () => {
  let service: MechanicMediaService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.WORKSHOP_MEDIA_BUCKET = 'workshop-media-bucket';
    service = new MechanicMediaService(
      mockPrisma,
      mockTenantContext,
      mockMediaStorage,
    );
    (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue({
      userId: 'user-1',
      email: 'tech@workshop.at',
      tenantId: TENANT_ID,
      role: 'TECH',
    });
    (mockTenantContext.getTenantId as jest.Mock).mockResolvedValue(TENANT_ID);
  });

  // ─── createMediaUploadPolicy ───────────────────────────────────────────────

  describe('createMediaUploadPolicy()', () => {
    const makeTaskForMedia = (overrides = {}) => ({
      id: TASK_ID,
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_id: MECHANIC_ID,
      workshop_order_id: ORDER_ID,
      workshop_order: { mechanic_id: MECHANIC_ID, bay_id: null },
      ...overrides,
    });

    it('throws NotFoundException when task not found', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createMediaUploadPolicy(MECHANIC_ID, TASK_ID, {
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when task is DONE', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForMedia({ status: WorkshopTaskStatus.DONE }),
      );

      await expect(
        service.createMediaUploadPolicy(MECHANIC_ID, TASK_ID, {
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('calls mediaStorage.generateUploadPolicy with tenant-scoped params', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForMedia(),
      );
      const expiresAt = new Date(Date.now() + 900_000);
      (mockMediaStorage.generateUploadPolicy as jest.Mock).mockResolvedValue({
        uploadUrl: 'https://storage.googleapis.com/bucket',
        formFields: { key: 'tenants/t1/orders/o1/tasks/t1/uuid.jpg' },
        storageBucket: 'workshop-media',
        storageKey: 'tenants/t1/orders/o1/tasks/t1/uuid.jpg',
        expiresAt,
      });

      const result = await service.createMediaUploadPolicy(
        MECHANIC_ID,
        TASK_ID,
        {
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        },
      );

      expect(mockMediaStorage.generateUploadPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          orderId: ORDER_ID,
          taskId: TASK_ID,
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      );
      expect(result.expiresAt).toBe(expiresAt.toISOString());
    });
  });

  describe('saveMediaMetadata()', () => {
    const MEDIA_BUCKET = 'workshop-media-bucket';
    const validStorageKey = `tenants/${TENANT_ID}/orders/${ORDER_ID}/tasks/${TASK_ID}/uuid.jpg`;

    const makeTaskForMedia = (overrides = {}) => ({
      id: TASK_ID,
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      workshop_order_id: ORDER_ID,
      workshop_order: { mechanic_id: MECHANIC_ID, bay_id: null },
      ...overrides,
    });

    // Note: WORKSHOP_MEDIA_BUCKET is set by the outer beforeEach so the service
    // constructor succeeds; no additional setup is needed here.

    it('throws NotFoundException when task not found', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.saveMediaMetadata(MECHANIC_ID, TASK_ID, {
          storageKey: validStorageKey,
          storageBucket: MEDIA_BUCKET,
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when task is DONE', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForMedia({ status: WorkshopTaskStatus.DONE }),
      );

      await expect(
        service.saveMediaMetadata(MECHANIC_ID, TASK_ID, {
          storageKey: validStorageKey,
          storageBucket: MEDIA_BUCKET,
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws BadRequestException when storageBucket does not match configured bucket', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForMedia(),
      );

      await expect(
        service.saveMediaMetadata(MECHANIC_ID, TASK_ID, {
          storageKey: validStorageKey,
          storageBucket: 'some-other-bucket',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when storageKey does not start with expected tenant prefix', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForMedia(),
      );

      await expect(
        service.saveMediaMetadata(MECHANIC_ID, TASK_ID, {
          storageKey: 'arbitrary/path/file.jpg',
          storageBucket: MEDIA_BUCKET,
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persists WorkshopMedia without manual realtime emit (extension handles it)', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForMedia(),
      );
      const now = new Date();
      (mockPrisma.workshopMedia.create as jest.Mock).mockResolvedValue({
        id: 'media-1',
        workshop_order_id: ORDER_ID,
        workshop_task_id: TASK_ID,
        uploaded_by_employee_id: MECHANIC_ID,
        storage_bucket: MEDIA_BUCKET,
        storage_key: validStorageKey,
        url_strategy: WorkshopMediaUrlStrategy.SIGNED,
        mime_type: 'image/jpeg',
        size_bytes: 102400,
        duration_seconds: null,
        caption: null,
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.saveMediaMetadata(MECHANIC_ID, TASK_ID, {
        storageKey: validStorageKey,
        storageBucket: MEDIA_BUCKET,
        mimeType: 'image/jpeg',
        sizeBytes: 102400,
      });

      expect(mockPrisma.workshopMedia.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: TENANT_ID,
            workshop_order_id: ORDER_ID,
            workshop_task_id: TASK_ID,
            uploaded_by_employee_id: MECHANIC_ID,
            url_strategy: WorkshopMediaUrlStrategy.SIGNED,
            mime_type: 'image/jpeg',
            size_bytes: 102400,
          }),
        }),
      );
      expect(result.id).toBe('media-1');
      // The Prisma realtime extension emits the event; service no longer calls manually.
      expect(mockRealtimeService.emitEntityUpdated).not.toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ type: 'WORKSHOP_MEDIA', action: 'CREATED' }),
      );
    });
  });
});
