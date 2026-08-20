import { InternalServerErrorException } from '@nestjs/common';
import { WorkshopPdfService } from './workshop-pdf.service';
import type { CloudTasksService } from '../common/services/cloud-tasks.service';
import type { TenantContextService } from '../common/services/tenant-context.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import type { PdfStorage } from '../common/pdf/pdf-storage';

describe('WorkshopPdfService.requestGeneration', () => {
  const tenantId = 'tenant-1';
  const workshopOrderId = 'workshop-1';
  const targetBaseUrl = 'https://worker.example.com/api';

  const orderRow = {
    id: workshopOrderId,
    tenant_id: tenantId,
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  };

  let service: WorkshopPdfService;
  let cloudTasks: jest.Mocked<Pick<CloudTasksService, 'isEnabled' | 'enqueuePdfGeneration'>>;
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
      {} as WorkshopPdfRenderer,
      {} as PdfStorage,
      cloudTasks as unknown as CloudTasksService,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NODE_ENV;
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
});
