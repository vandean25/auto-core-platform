import { InternalServerErrorException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service';

describe('InvoicePdfService.requestGeneration', () => {
  const originalEnv = { ...process.env };
  const tenantId = 'tenant-1';
  const invoiceId = 'invoice-1';

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fails closed in production when Cloud Tasks is unavailable', async () => {
    delete process.env.CLOUD_TASKS_ENABLED;
    const { service, renderer } = createService({
      cloudTasksEnabled: false,
    });
    const generateNow = jest
      .spyOn(service, 'generateNow')
      .mockResolvedValue({
        invoiceId,
        bucket: 'bucket',
        key: 'key',
        generatedAt: new Date(),
      });

    await expect(
      service.requestGeneration(invoiceId, { targetBaseUrl: '' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(generateNow).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('enqueues in production without rendering inline', async () => {
    process.env.CLOUD_TASKS_ENABLED = 'true';
    const { service, renderer, enqueuePdfGeneration } = createService({
      cloudTasksEnabled: true,
    });
    enqueuePdfGeneration.mockResolvedValue({ taskId: 'task-1' });
    const generateNow = jest.spyOn(service, 'generateNow');

    await expect(
      service.requestGeneration(invoiceId, {
        targetBaseUrl: 'https://worker.example.com/api',
      }),
    ).resolves.toMatchObject({
      mode: 'enqueued',
      invoiceId,
      taskId: 'task-1',
    });

    expect(generateNow).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  function createService(options: { cloudTasksEnabled: boolean }) {
    const renderer = { render: jest.fn() };
    const storage = {
      uploadPdf: jest.fn(),
      getPdfStream: jest.fn(),
    };
    const enqueuePdfGeneration = jest.fn();
    const prisma = {
      client: {
        invoice: {
          findFirst: jest.fn().mockResolvedValue({
            id: invoiceId,
            status: InvoiceStatus.ISSUED,
            pdf_storage_bucket: null,
            pdf_storage_key: null,
            pdf_generated_at: null,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
    };
    const cloudTasks = {
      isEnabled: jest.fn().mockReturnValue(options.cloudTasksEnabled),
      enqueuePdfGeneration,
    };

    const service = new InvoicePdfService(
      prisma as never,
      renderer as never,
      storage as never,
      cloudTasks as never,
      tenantContext as never,
    );

    return { service, renderer, enqueuePdfGeneration };
  }
});
