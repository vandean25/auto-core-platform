import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service';
import type { CloudTasksService } from '../common/services/cloud-tasks.service';
import type { TenantContextService } from '../common/services/tenant-context.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { InvoicePdfRenderer } from './invoice-pdf.renderer';
import type { PdfStorage } from '../common/pdf/pdf-storage';
import type { InvoiceSnapshot } from './invoice-snapshot';

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

describe('InvoicePdfService.generateNow', () => {
  const tenantId = 'tenant-1';
  const invoiceId = 'invoice-1';
  const validSnapshot: InvoiceSnapshot = {
    id: invoiceId,
    invoice_number: 'INV-001',
    date: '2026-01-01T00:00:00.000Z',
    due_date: '2026-01-15T00:00:00.000Z',
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: null,
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Jane',
      last_name: 'Doe',
      email: null,
      phone: null,
      vat_id: null,
      address_street: null,
      address_city: null,
      address_zip: null,
      address_country: null,
    },
    vehicle: null,
    items: [
      {
        description: 'Service',
        quantity: '1.00',
        unit_price: '100.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '120.00',
        revenue_group_name: null,
      },
    ],
    snapshot_created_at: '2026-01-01T12:00:00.000Z',
  };

  let service: InvoicePdfService;
  let renderer: jest.Mocked<Pick<InvoicePdfRenderer, 'render'>>;
  let storage: jest.Mocked<Pick<PdfStorage, 'uploadPdf'>>;
  let prisma: {
    client: {
      invoice: {
        findFirst: jest.Mock;
        updateMany: jest.Mock;
      };
    };
  };

  beforeEach(() => {
    renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    };
    storage = {
      uploadPdf: jest.fn().mockResolvedValue({
        bucket: 'bucket',
        key: 'invoices/invoice-1.pdf',
        etag: 'etag-1',
      }),
    };
    prisma = {
      client: {
        invoice: {
          findFirst: jest.fn().mockResolvedValue({
            id: invoiceId,
            status: InvoiceStatus.ISSUED,
            snapshot: validSnapshot,
            pdf_storage_bucket: null,
            pdf_storage_key: null,
            pdf_generated_at: null,
            customer_id: 'customer-1',
            workshop_order_id: null,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    service = new InvoicePdfService(
      prisma as unknown as PrismaService,
      renderer,
      storage,
      {} as CloudTasksService,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
    );
  });

  it('returns cached metadata without rendering when PDF already exists', async () => {
    const generatedAt = new Date('2026-04-01T00:00:00.000Z');
    prisma.client.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      status: InvoiceStatus.ISSUED,
      snapshot: validSnapshot,
      pdf_storage_bucket: 'bucket',
      pdf_storage_key: 'invoices/invoice-1.pdf',
      pdf_generated_at: generatedAt,
      customer_id: 'customer-1',
      workshop_order_id: null,
    });

    await expect(service.generateNow(invoiceId)).resolves.toEqual({
      invoiceId,
      bucket: 'bucket',
      key: 'invoices/invoice-1.pdf',
      generatedAt,
    });

    expect(renderer.render).not.toHaveBeenCalled();
    expect(storage.uploadPdf).not.toHaveBeenCalled();
  });

  it('rejects draft invoices', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      status: InvoiceStatus.DRAFT,
      snapshot: validSnapshot,
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
      customer_id: 'customer-1',
      workshop_order_id: null,
    });

    await expect(service.generateNow(invoiceId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws when invoice is missing', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue(null);

    await expect(service.generateNow(invoiceId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
