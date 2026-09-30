import { createHash } from 'node:crypto';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service.js';
import type { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import { hashInvoiceSnapshot } from './invoice-snapshot-hash.js';

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
  let cloudTasks: jest.Mocked<
    Pick<CloudTasksService, 'isEnabled' | 'enqueuePdfGeneration'>
  >;
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
      undefined,
      {
        listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
      } as never,
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
      undefined,
      {
        listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
      } as never,
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

  it('generates PDF for FINALIZED invoices', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      status: InvoiceStatus.FINALIZED,
      snapshot: validSnapshot,
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
      customer_id: 'customer-1',
      workshop_order_id: null,
    });

    await expect(service.generateNow(invoiceId)).resolves.toEqual(
      expect.objectContaining({
        invoiceId,
        bucket: 'bucket',
        key: 'invoices/invoice-1.pdf',
      }),
    );

    expect(renderer.render).toHaveBeenCalled();
    expect(storage.uploadPdf).toHaveBeenCalled();
  });

  it('throws when invoice is missing', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue(null);

    await expect(service.generateNow(invoiceId)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('InvoicePdfService.getPdf', () => {
  const tenantId = 'tenant-1';
  const invoiceId = 'invoice-1';

  let service: InvoicePdfService;
  let storage: jest.Mocked<
    Pick<PdfStorage, 'getPdfStream' | 'readImmutablePdfGeneration'>
  >;
  let prisma: {
    client: {
      invoice: {
        findFirst: jest.Mock;
        updateMany: jest.Mock;
      };
    };
  };

  beforeEach(() => {
    storage = {
      getPdfStream: jest.fn().mockResolvedValue({
        bucket: 'bucket',
        key: 'invoices/invoice-1.pdf',
        stream: {} as never,
        contentType: 'application/pdf',
        contentLength: 100,
      }),
      readImmutablePdfGeneration: jest.fn(),
    };
    prisma = {
      client: {
        invoice: {
          findFirst: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    service = new InvoicePdfService(
      prisma as unknown as PrismaService,
      {} as InvoicePdfRenderer,
      storage,
      {} as CloudTasksService,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
      undefined,
      {
        listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
      } as never,
    );
  });

  it('scopes invoice PDF lookup to the tenant and authorized sites', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue(null);

    await expect(service.getPdf(invoiceId)).rejects.toThrow('Invoice not found');

    expect(prisma.client.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: invoiceId,
          tenant_id: tenantId,
          site_id: { in: ['site-1'] },
        },
      }),
    );
  });

  it('streams from cached metadata when pdf_storage fields are set', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      invoice_number: 'RE-2026-0001',
      pdf_storage_bucket: 'bucket',
      pdf_storage_key: 'invoices/invoice-1.pdf',
      pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    const result = await service.getPdf(invoiceId);

    expect(storage.getPdfStream).toHaveBeenCalledWith({
      bucket: 'bucket',
      key: 'invoices/invoice-1.pdf',
    });
    expect(result.filename).toBe('invoice-RE-2026-0001.pdf');
  });

  it('falls back to the default GCS key when metadata is missing', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      invoice_number: 'RE-2026-0001',
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
    });

    await service.getPdf(invoiceId);

    expect(storage.getPdfStream).toHaveBeenCalledWith({
      key: 'invoices/invoice-1.pdf',
    });
    expect(prisma.client.invoice.updateMany).toHaveBeenCalled();
  });

  it('returns not generated yet when metadata and storage are missing', async () => {
    prisma.client.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      invoice_number: null,
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
    });
    storage.getPdfStream.mockRejectedValue(
      new NotFoundException('PDF not found in storage'),
    );

    await expect(service.getPdf(invoiceId)).rejects.toThrow(
      'Invoice PDF is not generated yet',
    );
  });

  it('streams the pinned branded archive generation instead of legacy PDF storage', async () => {
    const frozenSnapshot = {
      template_version: 'invoice-brand-v1',
      branding: { schema_version: 1 },
    };
    const snapshotHash = hashInvoiceSnapshot(frozenSnapshot);
    const key = `invoice-archives/${tenantId}/${invoiceId}/${snapshotHash}/invoice-brand-v1.pdf`;
    const bytes = Buffer.from('immutable branded pdf');
    storage.readImmutablePdfGeneration.mockResolvedValue({
      bucket: 'archive-bucket',
      key,
      generation: '44',
      sha256: 'c'.repeat(64),
      customMetadata: {
        tenant_id: tenantId,
        invoice_id: invoiceId,
        snapshot_sha256: snapshotHash,
        template_version: 'invoice-brand-v1',
        pdf_sha256: 'c'.repeat(64),
      },
      body: bytes,
    });
    prisma.client.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      invoice_number: 'RE-2026-0001',
      snapshot: frozenSnapshot,
      pdf_storage_bucket: 'legacy-bucket',
      pdf_storage_key: 'invoices/invoice-1.pdf',
      pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
      pdf_archive_bucket: 'archive-bucket',
      pdf_archive_key: key,
      pdf_archive_generation: '44',
      pdf_archive_sha256: 'c'.repeat(64),
    });

    const result = await service.getPdf(invoiceId);

    expect(storage.readImmutablePdfGeneration).toHaveBeenCalledWith({
      bucket: 'archive-bucket',
      key,
      generation: '44',
      expectedSha256: 'c'.repeat(64),
    });
    expect(storage.getPdfStream).not.toHaveBeenCalled();
    expect(result.contentLength).toBe(bytes.length);
  });
});

describe('InvoicePdfService branded archive publication', () => {
  const logoBytes = Buffer.from('logo bytes');
  const logoSha256 = createHash('sha256').update(logoBytes).digest('hex');
  const snapshot = {
    id: 'invoice-1',
    template_version: 'invoice-brand-v1',
    branding: {
      schema_version: 1,
      profile_id: null,
      profile_revision: 0,
      preset_id: 'standard-v1',
      renderer_version: 'invoice-brand-v1',
      font_id: 'acp-sans-v1',
      tokens: {
        primary_color: '#334155',
        secondary_color: '#E5E7EB',
        header_band: 'primary',
        footer_band: 'secondary',
        header_text: '',
        footer_text: '',
      },
      logo: {
        asset_id: 'asset-1',
        bucket: 'brand-bucket',
        key: 'logos/logo.png',
        generation: '17',
        sha256: logoSha256,
        mime_type: 'image/png',
        width: 120,
        height: 40,
      },
      resolved_at: '2026-09-28T00:00:00.000Z',
    },
  } as unknown as InvoiceSnapshot;

  const originalBucket = process.env.INVOICE_PDF_BUCKET;

  afterEach(() => {
    if (originalBucket === undefined) {
      delete process.env.INVOICE_PDF_BUCKET;
    } else {
      process.env.INVOICE_PDF_BUCKET = originalBucket;
    }
  });

  function createArchiveGenerator(
    storage: Record<string, jest.Mock>,
    invoice: {
      updateMany: jest.Mock;
      findFirst?: jest.Mock;
    },
  ) {
    const service = new InvoicePdfService(
      {
        client: {
          invoice,
          invoiceBrandAssetReference: { findFirst: jest.fn() },
        },
      } as never,
      {
        render: jest.fn().mockResolvedValue(Buffer.from('rendered pdf')),
      } as never,
      storage as never,
      {} as never,
      {} as never,
      undefined,
      {
        listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
      } as never,
    );
    const generateBrandedArchive = (
      service as unknown as {
        generateBrandedArchive: (
          input: {
            invoice: {
              id: string;
              tenant_id: string;
              legal_entity_id: string;
              snapshot: unknown;
            };
            renderSnapshot: InvoiceSnapshot;
            frozenSnapshot: unknown;
            tenantId: string;
          },
        ) => Promise<{ invoiceId: string; bucket: string; key: string }>;
      }
    ).generateBrandedArchive.bind(service);
    return (
      invoice: {
        id: string;
        tenant_id: string;
        legal_entity_id: string;
        snapshot?: unknown;
      },
      renderSnapshot: InvoiceSnapshot,
      tenantId: string,
    ) => {
      const frozenSnapshot = invoice.snapshot ?? renderSnapshot;
      return generateBrandedArchive({
        invoice: { ...invoice, snapshot: frozenSnapshot },
        renderSnapshot,
        frozenSnapshot,
        tenantId,
      });
    };
  }

  function createArchiveIdentity(frozenSnapshot: InvoiceSnapshot) {
    return {
      tenant_id: 'tenant-1',
      invoice_id: 'invoice-1',
      snapshot_sha256: hashInvoiceSnapshot(frozenSnapshot),
      template_version: 'invoice-brand-v1',
    };
  }

  function createArchive(
    identity: ReturnType<typeof createArchiveIdentity>,
    generation: string,
    pdfBytes: Buffer,
  ) {
    return {
      bucket: 'invoice-bucket',
      key: `invoice-archives/tenant-1/invoice-1/${identity.snapshot_sha256}/invoice-brand-v1.pdf`,
      generation,
      sha256: createHash('sha256').update(pdfBytes).digest('hex'),
      customMetadata: {
        ...identity,
        pdf_sha256: createHash('sha256').update(pdfBytes).digest('hex'),
      },
      body: pdfBytes,
    };
  }

  it('renders and publishes exact frozen logo bytes with deterministic archive identity', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    };
    const archive = {
      bucket: 'invoice-bucket',
      key: 'archive-key.pdf',
      generation: '42',
      sha256: 'b'.repeat(64),
      customMetadata: {
        tenant_id: 'tenant-1',
        invoice_id: 'invoice-1',
        snapshot_sha256: 'a'.repeat(64),
        template_version: 'invoice-brand-v1',
        pdf_sha256: 'b'.repeat(64),
      },
    };
    const storage = {
      publishImmutablePdf: jest.fn().mockResolvedValue(archive),
    };
    const prisma = {
      client: {
        invoice: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        invoiceBrandAssetReference: {
          findFirst: jest.fn().mockResolvedValue({
            asset: {
              bucket: 'brand-bucket',
              object_key: 'logos/logo.png',
              object_generation: '17',
              sha256: logoSha256,
              detected_mime_type: 'image/png',
              pixel_width: 120,
              pixel_height: 40,
            },
          }),
        },
      },
    };
    const brandingStorage = {
      readGeneration: jest.fn().mockResolvedValue(logoBytes),
    };
    const service = new InvoicePdfService(
      prisma as never,
      renderer as never,
      storage as never,
      {} as never,
      {} as never,
      brandingStorage as never,
      {
        listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
      } as never,
    );
    const invoice = {
      id: 'invoice-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'entity-1',
    };
    const generate = (
      service as unknown as {
        generateBrandedArchive: (
          input: {
            invoice: typeof invoice;
            renderSnapshot: InvoiceSnapshot;
            frozenSnapshot: unknown;
            tenantId: string;
          },
        ) => Promise<unknown>;
      }
    ).generateBrandedArchive.bind(service);
    await generate({
      invoice: { ...invoice, snapshot },
      renderSnapshot: snapshot,
      frozenSnapshot: snapshot,
      tenantId: 'tenant-1',
    });

    expect(brandingStorage.readGeneration).toHaveBeenCalledWith(
      'brand-bucket',
      'logos/logo.png',
      '17',
    );
    expect(renderer.render).toHaveBeenCalledWith(snapshot, {
      logoPng: logoBytes,
    });
    expect(storage.publishImmutablePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `invoice-archives/tenant-1/invoice-1/${hashInvoiceSnapshot(snapshot)}/invoice-brand-v1.pdf`,
        customMetadata: expect.objectContaining({
          tenant_id: 'tenant-1',
          invoice_id: 'invoice-1',
          template_version: 'invoice-brand-v1',
        }),
      }),
    );
    expect(prisma.client.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdf_archive_bucket: 'invoice-bucket',
          pdf_archive_generation: '42',
          pdf_archive_sha256: 'b'.repeat(64),
        }),
      }),
    );
  });

  it('uses the committed snapshot for archive identity while rendering its adapted view', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const renderSnapshot = {
      ...snapshot,
      branding: { ...snapshot.branding, logo: null },
    };
    const frozenSnapshot = {
      ...renderSnapshot,
      committed_snapshot_marker: 'original-v2-snapshot',
    };
    const storage = {
      publishImmutablePdf: jest.fn().mockResolvedValue({
        bucket: 'invoice-bucket',
        key: 'archive-key.pdf',
        generation: '43',
        sha256: 'c'.repeat(64),
        customMetadata: {
          tenant_id: 'tenant-1',
          invoice_id: 'invoice-1',
          snapshot_sha256: hashInvoiceSnapshot(frozenSnapshot),
          template_version: 'invoice-brand-v1',
        },
      }),
    };
    const generate = createArchiveGenerator(storage, {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    });

    await generate(
      {
        id: 'invoice-1',
        tenant_id: 'tenant-1',
        legal_entity_id: 'entity-1',
        snapshot: frozenSnapshot,
      },
      renderSnapshot,
      'tenant-1',
    );

    expect(storage.publishImmutablePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `invoice-archives/tenant-1/invoice-1/${hashInvoiceSnapshot(frozenSnapshot)}/invoice-brand-v1.pdf`,
        customMetadata: expect.objectContaining({
          snapshot_sha256: hashInvoiceSnapshot(frozenSnapshot),
        }),
      }),
    );
  });

  it('adopts a verified create-only winner after another renderer publishes first', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const identity = {
      tenant_id: 'tenant-1',
      invoice_id: 'invoice-1',
      snapshot_sha256: hashInvoiceSnapshot({
        ...snapshot,
        branding: { ...snapshot.branding, logo: null },
      }),
      template_version: 'invoice-brand-v1',
    };
    const key = `invoice-archives/tenant-1/invoice-1/${identity.snapshot_sha256}/invoice-brand-v1.pdf`;
    const archive = {
      bucket: 'invoice-bucket',
      key,
      generation: '45',
      sha256: 'd'.repeat(64),
      customMetadata: { ...identity, pdf_sha256: 'd'.repeat(64) },
      body: Buffer.from('winning pdf'),
    };
    const precondition = Object.assign(new Error('already exists'), {
      code: 412,
    });
    const storage = {
      publishImmutablePdf: jest.fn().mockRejectedValue(precondition),
      readImmutablePdfByKey: jest.fn().mockResolvedValue(archive),
    };
    const prisma = {
      client: {
        invoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        invoiceBrandAssetReference: { findFirst: jest.fn() },
      },
    };
    const service = new InvoicePdfService(
      prisma as never,
      {
        render: jest.fn().mockResolvedValue(Buffer.from('losing pdf')),
      } as never,
      storage as never,
      {} as never,
      {} as never,
      undefined,
      {
        listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
      } as never,
    );
    const generate = (
      service as unknown as {
        generateBrandedArchive: (
          input: {
            invoice: { id: string; tenant_id: string; legal_entity_id: string; snapshot: unknown };
            renderSnapshot: InvoiceSnapshot;
            frozenSnapshot: unknown;
            tenantId: string;
          },
        ) => Promise<unknown>;
      }
    ).generateBrandedArchive.bind(service);

    const renderSnapshot = {
      ...snapshot,
      branding: { ...snapshot.branding, logo: null },
    };
    await generate({
      invoice: {
        id: 'invoice-1',
        tenant_id: 'tenant-1',
        legal_entity_id: 'entity-1',
        snapshot: renderSnapshot,
      },
      renderSnapshot,
      frozenSnapshot: renderSnapshot,
      tenantId: 'tenant-1',
    });

    expect(storage.readImmutablePdfByKey).toHaveBeenCalledWith({
      bucket: 'invoice-bucket',
      key,
      expectedIdentity: identity,
    });
    expect(prisma.client.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdf_archive_generation: '45',
          pdf_archive_sha256: 'd'.repeat(64),
        }),
      }),
    );
  });

  it('repairs archive metadata after publication succeeded and the first database write failed', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const frozenSnapshot = {
      ...snapshot,
      branding: { ...snapshot.branding, logo: null },
    };
    const identity = createArchiveIdentity(frozenSnapshot);
    const pdfBytes = Buffer.from('immutable winner');
    const archive = createArchive(identity, '51', pdfBytes);
    const precondition = Object.assign(new Error('archive already exists'), {
      code: 412,
    });
    const storage = {
      publishImmutablePdf: jest
        .fn()
        .mockResolvedValueOnce(archive)
        .mockRejectedValueOnce(precondition),
      readImmutablePdfByKey: jest.fn().mockResolvedValue(archive),
    };
    const metadataWrite = jest
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ count: 1 });
    const generate = createArchiveGenerator(storage, {
      updateMany: metadataWrite,
      findFirst: jest.fn(),
    });
    const invoice = {
      id: 'invoice-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'entity-1',
    };

    await expect(generate(invoice, frozenSnapshot, 'tenant-1')).rejects.toThrow(
      'database unavailable',
    );
    await expect(
      generate(invoice, frozenSnapshot, 'tenant-1'),
    ).resolves.toMatchObject({
      invoiceId: 'invoice-1',
      bucket: 'invoice-bucket',
      key: archive.key,
    });

    expect(storage.publishImmutablePdf).toHaveBeenCalledTimes(2);
    expect(storage.readImmutablePdfByKey).toHaveBeenCalledWith({
      bucket: 'invoice-bucket',
      key: archive.key,
      expectedIdentity: identity,
    });
    expect(metadataWrite).toHaveBeenCalledTimes(2);
    expect(metadataWrite).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdf_archive_generation: '51',
          pdf_archive_sha256: archive.sha256,
        }),
      }),
    );
  });

  it('accepts a concurrent metadata winner only when every archive pointer field matches', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const frozenSnapshot = {
      ...snapshot,
      branding: { ...snapshot.branding, logo: null },
    };
    const identity = createArchiveIdentity(frozenSnapshot);
    const archive = createArchive(
      identity,
      '52',
      Buffer.from('parallel winner'),
    );
    const conflict = Object.assign(new Error('archive already exists'), {
      code: 412,
    });
    const storage = {
      publishImmutablePdf: jest.fn().mockRejectedValue(conflict),
      readImmutablePdfByKey: jest.fn().mockResolvedValue(archive),
    };
    const invoice = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue({
        pdf_archive_bucket: archive.bucket,
        pdf_archive_key: archive.key,
        pdf_archive_generation: archive.generation,
        pdf_archive_sha256: archive.sha256,
      }),
    };
    const generate = createArchiveGenerator(storage, invoice);

    await expect(
      generate(
        { id: 'invoice-1', tenant_id: 'tenant-1', legal_entity_id: 'entity-1' },
        frozenSnapshot,
        'tenant-1',
      ),
    ).resolves.toMatchObject({ key: archive.key });
  });

  it('rejects an archive metadata winner with a different generation or checksum', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const frozenSnapshot = {
      ...snapshot,
      branding: { ...snapshot.branding, logo: null },
    };
    const identity = createArchiveIdentity(frozenSnapshot);
    const archive = createArchive(
      identity,
      '53',
      Buffer.from('verified winner'),
    );
    const conflict = Object.assign(new Error('archive already exists'), {
      code: 412,
    });
    const storage = {
      publishImmutablePdf: jest.fn().mockRejectedValue(conflict),
      readImmutablePdfByKey: jest.fn().mockResolvedValue(archive),
    };
    const generate = createArchiveGenerator(storage, {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue({
        pdf_archive_bucket: archive.bucket,
        pdf_archive_key: archive.key,
        pdf_archive_generation: 'older-generation',
        pdf_archive_sha256: 'f'.repeat(64),
      }),
    });

    await expect(
      generate(
        { id: 'invoice-1', tenant_id: 'tenant-1', legal_entity_id: 'entity-1' },
        frozenSnapshot,
        'tenant-1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_RENDER_INPUT_UNAVAILABLE' },
    });
  });

  it('uses one immutable create-only winner for parallel archive renderers', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const frozenSnapshot = {
      ...snapshot,
      branding: { ...snapshot.branding, logo: null },
    };
    const identity = createArchiveIdentity(frozenSnapshot);
    const archive = createArchive(
      identity,
      '54',
      Buffer.from('single immutable winner'),
    );
    const conflict = Object.assign(new Error('archive already exists'), {
      code: 412,
    });
    let publishAttempts = 0;
    const storage = {
      publishImmutablePdf: jest.fn().mockImplementation(async () => {
        publishAttempts += 1;
        if (publishAttempts === 1) return archive;
        throw conflict;
      }),
      readImmutablePdfByKey: jest.fn().mockResolvedValue(archive),
    };
    const metadataWrite = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const invoice = {
      updateMany: metadataWrite,
      findFirst: jest.fn().mockResolvedValue({
        pdf_archive_bucket: archive.bucket,
        pdf_archive_key: archive.key,
        pdf_archive_generation: archive.generation,
        pdf_archive_sha256: archive.sha256,
      }),
    };
    const generate = createArchiveGenerator(storage, invoice);
    const invoiceInput = {
      id: 'invoice-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'entity-1',
    };

    const results = await Promise.all([
      generate(invoiceInput, frozenSnapshot, 'tenant-1'),
      generate(invoiceInput, frozenSnapshot, 'tenant-1'),
    ]);

    expect(results.map((result) => result.key)).toEqual([
      archive.key,
      archive.key,
    ]);
    expect(storage.publishImmutablePdf).toHaveBeenCalledTimes(2);
    expect(storage.readImmutablePdfByKey).toHaveBeenCalledTimes(1);
    expect(metadataWrite).toHaveBeenCalledTimes(2);
    expect(metadataWrite.mock.calls.map(([args]) => args.data)).toEqual([
      expect.objectContaining({
        pdf_archive_generation: '54',
        pdf_archive_sha256: archive.sha256,
      }),
      expect.objectContaining({
        pdf_archive_generation: '54',
        pdf_archive_sha256: archive.sha256,
      }),
    ]);
  });

  it('does not persist metadata when the GCS 412 winner fails identity verification', async () => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-bucket';
    const frozenSnapshot = {
      ...snapshot,
      branding: { ...snapshot.branding, logo: null },
    };
    const conflict = Object.assign(new Error('archive already exists'), {
      code: 412,
    });
    const storage = {
      publishImmutablePdf: jest.fn().mockRejectedValue(conflict),
      readImmutablePdfByKey: jest
        .fn()
        .mockRejectedValue(
          new InternalServerErrorException('identity mismatch'),
        ),
    };
    const metadataWrite = jest.fn();
    const generate = createArchiveGenerator(storage, {
      updateMany: metadataWrite,
      findFirst: jest.fn(),
    });

    await expect(
      generate(
        { id: 'invoice-1', tenant_id: 'tenant-1', legal_entity_id: 'entity-1' },
        frozenSnapshot,
        'tenant-1',
      ),
    ).rejects.toThrow('identity mismatch');
    expect(metadataWrite).not.toHaveBeenCalled();
  });
});
