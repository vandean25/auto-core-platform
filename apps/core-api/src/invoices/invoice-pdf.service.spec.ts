import { InternalServerErrorException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service';
import type { CloudTasksService } from '../common/services/cloud-tasks.service';
import type { TenantContextService } from '../common/services/tenant-context.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { InvoicePdfRenderer } from './invoice-pdf.renderer';
import type { PdfStorage } from '../common/pdf/pdf-storage';

describe('InvoicePdfService.requestGeneration', () => {
  const tenantId = 'tenant-1';
  const invoiceId = 'invoice-1';
  const targetBaseUrl = 'https://worker.example.com/api';

  const invoiceRow = {
    id: invoiceId,
    status: InvoiceStatus.ISSUED,
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
  };

  let service: InvoicePdfService;
  let cloudTasks: jest.Mocked<Pick<CloudTasksService, 'isEnabled' | 'enqueuePdfGeneration'>>;
  let prisma: {
    client: {
      invoice: {
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
        invoice: {
          findFirst: jest.fn().mockResolvedValue(invoiceRow),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    service = new InvoicePdfService(
      prisma as unknown as PrismaService,
      {} as InvoicePdfRenderer,
      {} as PdfStorage,
      cloudTasks,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NODE_ENV;
    delete process.env.CLOUD_TASKS_ENABLED;
  });

  it('throws in production without Cloud Tasks config and does not generate inline', async () => {
    process.env.NODE_ENV = 'production';
    cloudTasks.isEnabled.mockReturnValue(false);

    const generateNowSpy = jest.spyOn(service, 'generateNow');

    await expect(
      service.requestGeneration(invoiceId, { targetBaseUrl }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(generateNowSpy).not.toHaveBeenCalled();
    expect(cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
  });

  it('enqueues in production when Cloud Tasks is configured and does not generate inline', async () => {
    process.env.NODE_ENV = 'production';
    cloudTasks.isEnabled.mockReturnValue(true);
    cloudTasks.enqueuePdfGeneration.mockResolvedValue({ taskId: 'task-1' });

    const generateNowSpy = jest.spyOn(service, 'generateNow');

    await expect(
      service.requestGeneration(invoiceId, { targetBaseUrl }),
    ).resolves.toEqual({
      mode: 'enqueued',
      invoiceId,
      bucket: null,
      key: null,
      generatedAt: null,
      taskId: 'task-1',
    });

    expect(cloudTasks.enqueuePdfGeneration).toHaveBeenCalledWith({
      kind: 'invoice',
      resourceId: invoiceId,
      targetBaseUrl,
      tenantId,
    });
    expect(generateNowSpy).not.toHaveBeenCalled();
  });

  it('generates inline in non-production when Cloud Tasks is disabled', async () => {
    process.env.NODE_ENV = 'development';
    cloudTasks.isEnabled.mockReturnValue(false);

    const generatedAt = new Date('2026-04-01T00:00:00.000Z');
    jest.spyOn(service, 'generateNow').mockResolvedValue({
      invoiceId,
      bucket: 'bucket',
      key: 'invoices/invoice-1.pdf',
      generatedAt,
    });

    await expect(
      service.requestGeneration(invoiceId, { targetBaseUrl: '' }),
    ).resolves.toEqual({
      mode: 'generated',
      invoiceId,
      bucket: 'bucket',
      key: 'invoices/invoice-1.pdf',
      generatedAt,
    });

    expect(cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
  });
});
