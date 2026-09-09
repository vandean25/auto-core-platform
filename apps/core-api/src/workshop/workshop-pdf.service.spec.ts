import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { WorkshopPdfService } from './workshop-pdf.service';
import type { CloudTasksService } from '../common/services/cloud-tasks.service';
import type { TenantContextService } from '../common/services/tenant-context.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import type { PdfStorage } from '../common/pdf/pdf-storage';
import { Readable } from 'node:stream';

describe('WorkshopPdfService', () => {
  const tenantId = 'tenant-1';
  const workshopOrderId = 'workshop-1';
  const targetBaseUrl = 'https://worker.example.com/api';

  const orderRow = {
    id: workshopOrderId,
    tenant_id: tenantId,
    order_number: 'WO-1',
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  };

  let service: WorkshopPdfService;
  let cloudTasks: jest.Mocked<
    Pick<CloudTasksService, 'isEnabled' | 'enqueuePdfGeneration'>
  >;
  let renderer: jest.Mocked<Pick<WorkshopPdfRenderer, 'render'>>;
  let storage: jest.Mocked<Pick<PdfStorage, 'uploadPdf' | 'getPdfStream'>>;
  let prisma: {
    client: {
      workshopOrder: {
        findFirst: jest.Mock;
        updateMany: jest.Mock;
      };
    };
  };

  beforeEach(() => {
    cloudTasks = {
      isEnabled: jest.fn(),
      enqueuePdfGeneration: jest.fn(),
    };

    renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('pdf-data')),
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
    };

    prisma = {
      client: {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue(orderRow),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    service = new WorkshopPdfService(
      prisma as unknown as PrismaService,
      renderer,
      storage,
      cloudTasks,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
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
        ...orderRow,
        pdf_storage_bucket: 'cached-bucket',
        pdf_storage_key: 'cached-key.pdf',
        pdf_generated_at: generatedAt,
        updatedAt: new Date('2026-04-01T09:00:00.000Z'),
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

      expect(renderer.render).toHaveBeenCalledWith(orderRow);
      expect(storage.uploadPdf).toHaveBeenCalledWith({
        key: `workshop-orders/${workshopOrderId}.pdf`,
        body: Buffer.from('pdf-data'),
        contentType: 'application/pdf',
      });
      expect(prisma.client.workshopOrder.updateMany).toHaveBeenCalledWith({
        where: { id: workshopOrderId, tenant_id: tenantId },
        data: expect.objectContaining({
          pdf_storage_bucket: 'test-bucket',
          pdf_storage_key: `workshop-orders/${workshopOrderId}.pdf`,
          pdf_generation_error: null,
        }),
      });
    });

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
