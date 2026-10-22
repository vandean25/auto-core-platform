import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { WorkshopCheckInStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { asFake } from '../invoices/invoice-fixtures.spec.support.js';
import type { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { WorkshopPdfService } from './workshop-pdf.service.js';
import type { WorkshopPdfRenderer } from './workshop-pdf.renderer.js';
import { buildWorkshopPdfFixtureCheckInSnapshot } from './workshop-pdf.fixture.js';

function stubCheckInPdfMediaLoading(
  mediaStorage: jest.Mocked<Pick<MechanicMediaStorage, 'readObjectBytes'>>,
  prisma: {
    client: {
      workshopMedia?: { findFirst: jest.Mock };
    };
  },
) {
  prisma.client.workshopMedia = {
    findFirst: jest.fn().mockResolvedValue({
      storage_bucket: 'media-bucket',
      storage_key: 'sig-1.png',
      mime_type: 'image/png',
    }),
  };
  mediaStorage.readObjectBytes.mockImplementation(async (_bucket, key) => {
    if (key === 'photo-1.jpg') {
      return Buffer.from('jpeg-photo-fixture');
    }
    if (key === 'sig-1.png') {
      return Buffer.from('signature-png-fixture');
    }
    return Buffer.from('media-bytes');
  });
}

describe('WorkshopPdfService', () => {
  const tenantId = 'tenant-1';
  const workshopOrderId = 'workshop-1';
  const targetBaseUrl = 'https://worker.example.com/api';

  const requestOrderRow = {
    id: workshopOrderId,
    tenant_id: tenantId,
    order_number: 'WO-1',
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
    pdf_render_input: null,
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    check_in: null,
  };

  const generationOrderRow = {
    id: workshopOrderId,
    order_number: 'WO-1',
    status: 'INTAKE',
    odometer: 1000,
    fuel_level: 50,
    reported_issue: null,
    notes: null,
    customer: {
      type: 'PRIVATE',
      first_name: 'Test',
      last_name: 'Driver',
      company_name: null,
      phone: null,
      email: null,
      address_zip: null,
      address_city: null,
      preferred_language: null as 'de' | 'en' | null,
    },
    vehicle: {
      make: 'VW',
      model: 'Golf',
      year: 2020,
      vin: null,
      plate: null,
    },
    tasks: [],
    check_in: null,
  };

  const pdfBytes = Buffer.from('pdf-data');

  let service: WorkshopPdfService;
  let cloudTasks: jest.Mocked<
    Pick<CloudTasksService, 'isEnabled' | 'enqueuePdfGeneration'>
  >;
  let renderer: jest.Mocked<Pick<WorkshopPdfRenderer, 'render'>>;
  let storage: jest.Mocked<
    Pick<
      PdfStorage,
      'uploadPdf' | 'getPdfStream' | 'publishImmutableObject' | 'readImmutableObjectByKey'
    >
  >;
  let mediaStorage: jest.Mocked<Pick<MechanicMediaStorage, 'readObjectBytes'>>;
  let prisma: {
    client: {
      workshopOrder: {
        findFirst: jest.Mock;
        updateMany: jest.Mock;
      };
      $transaction: jest.Mock;
      workshopCheckIn: {
        updateMany: jest.Mock;
      };
      tenant: { findFirst: jest.Mock };
      workshopMedia?: { findFirst: jest.Mock };
    };
  };

  beforeEach(() => {
    cloudTasks = {
      isEnabled: jest.fn(),
      enqueuePdfGeneration: jest.fn(),
    };

    renderer = {
      render: jest.fn().mockResolvedValue(pdfBytes),
    };

    storage = {
      uploadPdf: jest.fn().mockResolvedValue({
        bucket: 'test-bucket',
        key: `workshop-orders/${workshopOrderId}.pdf`,
        etag: 'etag-123',
      }),
      getPdfStream: jest.fn().mockResolvedValue({
        stream: Readable.from(['pdf content']),
        contentType: 'application/pdf',
        contentLength: 11,
      }),
      publishImmutableObject: jest.fn().mockResolvedValue({
        bucket: 'test-bucket',
        key: 'workshop-check-ins/archive.pdf',
        generation: '1',
        sha256: createHash('sha256').update(pdfBytes).digest('hex'),
        customMetadata: {},
      }),
      readImmutableObjectByKey: jest.fn(),
    };

    mediaStorage = {
      readObjectBytes: jest.fn().mockResolvedValue(Buffer.from('media-bytes')),
    };

    prisma = {
      client: {
        workshopOrder: {
          findFirst: jest.fn().mockImplementation(async (args) => {
            if (args?.select?.pdf_storage_key !== undefined) {
              return requestOrderRow;
            }
            return generationOrderRow;
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopCheckIn: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tenant: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ default_locale: 'de' as const }),
        },
        $transaction: jest.fn(async (fn) => fn(prisma.client)),
      },
    };

    service = new WorkshopPdfService(
      prisma as unknown as PrismaService,
      asFake<WorkshopPdfRenderer>(renderer),
      asFake<PdfStorage>(storage),
      asFake<CloudTasksService>(cloudTasks),
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
      asFake<MechanicMediaStorage>(mediaStorage),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NODE_ENV;
  });

  describe('requestGeneration', () => {
    it('throws NotFoundException when order does not exist', async () => {
      prisma.client.workshopOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.requestGeneration('non-existent', { targetBaseUrl }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns cached metadata if valid PDF exists', async () => {
      const generatedAt = new Date('2026-04-01T10:00:00.000Z');
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        ...requestOrderRow,
        pdf_storage_bucket: 'cached-bucket',
        pdf_storage_key: 'cached-key.pdf',
        pdf_generated_at: generatedAt,
        pdf_render_input: {
          schema_version: 2,
          check_in_content_sha256: null,
        },
        updatedAt: new Date('2026-04-01T09:00:00.000Z'),
        check_in: null,
      });

      const result = await service.requestGeneration(workshopOrderId, {
        targetBaseUrl,
      });

      expect(result).toEqual({
        mode: 'cached',
        workshopOrderId,
        bucket: 'cached-bucket',
        key: 'cached-key.pdf',
        generatedAt,
      });
      expect(cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
    });

    it('regenerates when a completed check-in was recorded after the cached PDF', async () => {
      const generatedAt = new Date('2026-04-01T10:00:00.000Z');
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        ...requestOrderRow,
        pdf_storage_bucket: 'cached-bucket',
        pdf_storage_key: 'cached-key.pdf',
        pdf_generated_at: generatedAt,
        pdf_render_input: {
          schema_version: 2,
          check_in_content_sha256: null,
        },
        updatedAt: new Date('2026-04-01T09:00:00.000Z'),
        check_in: {
          status: WorkshopCheckInStatus.COMPLETED,
          content_sha256: 'a'.repeat(64),
          completed_at: new Date('2026-04-01T11:00:00.000Z'),
        },
      });
      process.env.NODE_ENV = 'test';
      cloudTasks.isEnabled.mockReturnValue(false);
      jest.spyOn(service, 'generateNow').mockResolvedValue({
        workshopOrderId,
        bucket: 'bucket',
        key: 'workshop-orders/workshop-1.pdf',
        generatedAt: new Date(),
      });

      await expect(
        service.requestGeneration(workshopOrderId, { targetBaseUrl: '' }),
      ).resolves.toMatchObject({ mode: 'generated' });
    });

    it('throws in production without Cloud Tasks config and does not generate inline', async () => {
      process.env.NODE_ENV = 'production';
      cloudTasks.isEnabled.mockReturnValue(false);

      const generateNowSpy = jest.spyOn(service, 'generateNow');

      await expect(
        service.requestGeneration(workshopOrderId, { targetBaseUrl }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(generateNowSpy).not.toHaveBeenCalled();
      expect(cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
    });

    it('enqueues in production when Cloud Tasks is configured', async () => {
      process.env.NODE_ENV = 'production';
      cloudTasks.isEnabled.mockReturnValue(true);
      cloudTasks.enqueuePdfGeneration.mockResolvedValue({ taskId: 'task-2' });

      const generateNowSpy = jest.spyOn(service, 'generateNow');

      await expect(
        service.requestGeneration(workshopOrderId, { targetBaseUrl }),
      ).resolves.toEqual({
        mode: 'enqueued',
        workshopOrderId,
        bucket: null,
        key: null,
        generatedAt: null,
        taskId: 'task-2',
      });

      expect(cloudTasks.enqueuePdfGeneration).toHaveBeenCalledWith({
        kind: 'workshop-order',
        resourceId: workshopOrderId,
        tenantId,
        targetBaseUrl,
      });
      expect(generateNowSpy).not.toHaveBeenCalled();
    });

    it('generates inline in non-production when Cloud Tasks is disabled', async () => {
      process.env.NODE_ENV = 'test';
      cloudTasks.isEnabled.mockReturnValue(false);

      const generatedAt = new Date('2026-04-01T00:00:00.000Z');
      jest.spyOn(service, 'generateNow').mockResolvedValue({
        workshopOrderId,
        bucket: 'bucket',
        key: 'workshop-orders/workshop-1.pdf',
        generatedAt,
      });

      await expect(
        service.requestGeneration(workshopOrderId, { targetBaseUrl: '' }),
      ).resolves.toEqual({
        mode: 'generated',
        workshopOrderId,
        bucket: 'bucket',
        key: 'workshop-orders/workshop-1.pdf',
        generatedAt,
      });

      expect(cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
    });

    it('falls back to inline generation in non-production when enqueue fails', async () => {
      process.env.NODE_ENV = 'development';
      cloudTasks.isEnabled.mockReturnValue(true);
      cloudTasks.enqueuePdfGeneration.mockRejectedValue(
        new Error('Enqueue network failure'),
      );

      const generatedAt = new Date('2026-04-01T00:00:00.000Z');
      jest.spyOn(service, 'generateNow').mockResolvedValue({
        workshopOrderId,
        bucket: 'bucket',
        key: 'workshop-orders/workshop-1.pdf',
        generatedAt,
      });

      await expect(
        service.requestGeneration(workshopOrderId, { targetBaseUrl }),
      ).resolves.toEqual({
        mode: 'generated',
        workshopOrderId,
        bucket: 'bucket',
        key: 'workshop-orders/workshop-1.pdf',
        generatedAt,
      });
    });
  });

  describe('generateNow', () => {
    it('successfully loads order, renders, uploads, and updates DB', async () => {
      const result = await service.generateNow(workshopOrderId);

      expect(result.workshopOrderId).toBe(workshopOrderId);
      expect(result.bucket).toBe('test-bucket');
      expect(result.key).toBe(`workshop-orders/${workshopOrderId}.pdf`);
      expect(result.generatedAt).toBeInstanceOf(Date);

      expect(renderer.render).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workshopOrderId,
          check_in: null,
        }),
        { documentLocale: 'de', renderMode: 'localized' },
      );
      expect(storage.uploadPdf).toHaveBeenCalledWith({
        key: `workshop-orders/${workshopOrderId}.pdf`,
        body: pdfBytes,
        contentType: 'application/pdf',
      });
      expect(storage.publishImmutableObject).not.toHaveBeenCalled();
      expect(prisma.client.workshopOrder.updateMany).toHaveBeenCalledWith({
        where: { id: workshopOrderId, tenant_id: tenantId },
        data: expect.objectContaining({
          pdf_storage_bucket: 'test-bucket',
          pdf_storage_key: `workshop-orders/${workshopOrderId}.pdf`,
          pdf_generation_error: null,
          pdf_render_input: expect.objectContaining({
            check_in_content_sha256: null,
          }),
        }),
      });
    });

    it('stores en on pdf_render_input and renders localized copy when customer prefers en', async () => {
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        ...generationOrderRow,
        customer: {
          ...generationOrderRow.customer,
          preferred_language: 'en' as const,
        },
      });

      await service.generateNow(workshopOrderId);

      expect(renderer.render).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: expect.objectContaining({ preferred_language: 'en' }),
          check_in: null,
        }),
        { documentLocale: 'en', renderMode: 'localized' },
      );
      expect(prisma.client.workshopOrder.updateMany).toHaveBeenCalledWith({
        where: { id: workshopOrderId, tenant_id: tenantId },
        data: expect.objectContaining({
          pdf_render_input: expect.objectContaining({
            document_locale: 'en',
          }),
        }),
      });
    });

    it('publishes the immutable check-in PDF hash only after the final render', async () => {
      const snapshot = buildWorkshopPdfFixtureCheckInSnapshot();
      stubCheckInPdfMediaLoading(mediaStorage, prisma);
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        ...generationOrderRow,
        check_in: {
          id: snapshot.check_in_id,
          status: WorkshopCheckInStatus.COMPLETED,
          snapshot_json: snapshot,
          content_sha256: 'c'.repeat(64),
          pdf_sha256: null,
        },
      });

      await service.generateNow(workshopOrderId);

      expect(renderer.render).toHaveBeenCalled();
      expect(storage.uploadPdf).toHaveBeenCalled();
      expect(storage.publishImmutableObject).toHaveBeenCalledWith(
        expect.objectContaining({
          body: pdfBytes,
        }),
      );
      expect(prisma.client.workshopCheckIn.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pdf_sha256: null,
            status: WorkshopCheckInStatus.COMPLETED,
          }),
        }),
      );
      const checkInPersistOrder =
        prisma.client.workshopCheckIn.updateMany.mock.invocationCallOrder[0];
      const orderPdfPersistCallIndex =
        prisma.client.workshopOrder.updateMany.mock.calls.findIndex(
          (call) => call[0]?.data?.pdf_storage_key,
        );
      expect(orderPdfPersistCallIndex).toBeGreaterThanOrEqual(0);
      const orderPersistOrder =
        prisma.client.workshopOrder.updateMany.mock.invocationCallOrder[
          orderPdfPersistCallIndex
        ];
      expect(checkInPersistOrder).toBeLessThan(orderPersistOrder);
    });

    it('does not persist the mutable order PDF when check-in archive upload fails', async () => {
      const snapshot = buildWorkshopPdfFixtureCheckInSnapshot();
      stubCheckInPdfMediaLoading(mediaStorage, prisma);
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        ...generationOrderRow,
        check_in: {
          id: snapshot.check_in_id,
          status: WorkshopCheckInStatus.COMPLETED,
          snapshot_json: snapshot,
          content_sha256: 'c'.repeat(64),
          pdf_sha256: null,
        },
      });
      storage.publishImmutableObject.mockRejectedValue(
        new Error('GCS unavailable'),
      );

      await expect(service.generateNow(workshopOrderId)).rejects.toThrow(
        'GCS unavailable',
      );

      const persistPdfCalls = prisma.client.workshopOrder.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.pdf_storage_key,
      );
      expect(persistPdfCalls).toHaveLength(0);
      expect(prisma.client.workshopCheckIn.updateMany).not.toHaveBeenCalled();
    });

    it('does not publish a check-in archive hash when rendering fails', async () => {
      const snapshot = buildWorkshopPdfFixtureCheckInSnapshot();
      stubCheckInPdfMediaLoading(mediaStorage, prisma);
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        ...generationOrderRow,
        check_in: {
          id: snapshot.check_in_id,
          status: WorkshopCheckInStatus.COMPLETED,
          snapshot_json: snapshot,
          content_sha256: 'c'.repeat(64),
          pdf_sha256: null,
        },
      });
      renderer.render.mockRejectedValue(new Error('Browser crashed'));

      await expect(service.generateNow(workshopOrderId)).rejects.toThrow(
        'Browser crashed',
      );

      expect(storage.publishImmutableObject).not.toHaveBeenCalled();
      expect(prisma.client.workshopCheckIn.updateMany).not.toHaveBeenCalled();
    }, 15000);

    it('throws NotFoundException when order is not found', async () => {
      prisma.client.workshopOrder.findFirst.mockResolvedValue(null);

      await expect(service.generateNow('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('stores error and rethrows when rendering fails', async () => {
      const clientError = Object.assign(new Error('Browser crashed'), {
        status: 400,
      });
      renderer.render.mockRejectedValue(clientError);

      await expect(service.generateNow(workshopOrderId)).rejects.toThrow(
        'Browser crashed',
      );

      expect(prisma.client.workshopOrder.updateMany).toHaveBeenCalledWith({
        where: { id: workshopOrderId, tenant_id: tenantId },
        data: {
          pdf_generation_error:
            'PDF generation failed. Please try again or contact support.',
        },
      });
    }, 15000);
  });

  describe('getPdf', () => {
    it('streams PDF successfully when available', async () => {
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        id: workshopOrderId,
        order_number: 'WO-42',
        pdf_storage_bucket: 'test-bucket',
        pdf_storage_key: 'workshop-orders/wo-42.pdf',
      });

      const result = await service.getPdf(workshopOrderId);

      expect(result.filename).toBe('job-card-WO-42.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.contentLength).toBe(11);
      expect(result.stream).toBeDefined();
    });

    it('throws NotFoundException when order is missing', async () => {
      prisma.client.workshopOrder.findFirst.mockResolvedValue(null);

      await expect(service.getPdf('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when PDF key is missing', async () => {
      prisma.client.workshopOrder.findFirst.mockResolvedValue({
        id: workshopOrderId,
        order_number: 'WO-42',
        pdf_storage_bucket: 'test-bucket',
        pdf_storage_key: null,
      });

      await expect(service.getPdf(workshopOrderId)).rejects.toThrow(
        'Workshop PDF is not generated yet',
      );
    });
  });
});
