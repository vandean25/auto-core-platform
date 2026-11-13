import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreditNotePdfService } from './credit-note-pdf.service.js';
import type { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { InvoicePdfRenderer } from '../invoices/invoice-pdf.renderer.js';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';

// Test double: implements only the members these tests call.
function asFake<T>(double: Partial<T>): T {
  return double as T;
}

describe('CreditNotePdfService.getPdf', () => {
  const tenantId = 'tenant-1';
  const creditNoteId = 'credit-note-1';

  let service: CreditNotePdfService;
  let storage: jest.Mocked<Pick<PdfStorage, 'getPdfStream'>>;
  let getAuthenticatedUser: jest.Mock;
  let prisma: {
    client: {
      creditNote: {
        findFirst: jest.Mock;
        updateMany: jest.Mock;
      };
    };
  };

  beforeEach(() => {
    // Reads are gated by the shared credit-note read check; OWNER passes the role check and
    // skips the site lookup, so these fixtures do not need site membership rows.
    getAuthenticatedUser = jest.fn().mockReturnValue({ role: 'OWNER' });
    storage = {
      getPdfStream: jest.fn().mockResolvedValue({
        bucket: 'bucket',
        key: 'credit-notes/credit-note-1.pdf',
        stream: {} as never,
        contentType: 'application/pdf',
        contentLength: 100,
      }),
    };
    prisma = {
      client: {
        creditNote: {
          findFirst: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    service = new CreditNotePdfService(
      prisma as unknown as PrismaService,
      {} as InvoicePdfRenderer,
      asFake<PdfStorage>(storage),
      {} as CloudTasksService,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
        getAuthenticatedUser,
      } as unknown as TenantContextService,
    );
  });

  // Regression: getPdf had no role gate, so a TECH caller streamed any PDF in the tenant.
  it('refuses a TECH caller with 403 before opening the PDF', async () => {
    getAuthenticatedUser.mockReturnValue({ role: 'TECH' });
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      site_id: 'site-1',
      credit_number: 'CN-2026-0001',
      pdf_storage_bucket: 'bucket',
      pdf_storage_key: 'credit-notes/credit-note-1.pdf',
      pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(service.getPdf(creditNoteId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(storage.getPdfStream).not.toHaveBeenCalled();
  });

  it('streams from cached metadata when pdf_storage fields are set', async () => {
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      credit_number: 'CN-2026-0001',
      pdf_storage_bucket: 'bucket',
      pdf_storage_key: 'credit-notes/credit-note-1.pdf',
      pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    const result = await service.getPdf(creditNoteId);

    expect(storage.getPdfStream).toHaveBeenCalledWith({
      bucket: 'bucket',
      key: 'credit-notes/credit-note-1.pdf',
    });
    expect(result.filename).toBe('credit-note-CN-2026-0001.pdf');
  });

  it('falls back to the default GCS key when metadata is missing', async () => {
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      credit_number: 'CN-2026-0001',
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
    });

    await service.getPdf(creditNoteId);

    expect(storage.getPdfStream).toHaveBeenCalledWith({
      key: 'credit-notes/credit-note-1.pdf',
    });
    expect(prisma.client.creditNote.updateMany).toHaveBeenCalled();
  });

  it('streams from the canonical key when pdf_generated_at is set but storage metadata is incomplete', async () => {
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      credit_number: 'CN-2026-0001',
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    await service.getPdf(creditNoteId);

    expect(storage.getPdfStream).toHaveBeenCalledWith({
      key: 'credit-notes/credit-note-1.pdf',
    });
    expect(prisma.client.creditNote.updateMany).toHaveBeenCalled();
  });

  it('falls back to the canonical key when cached metadata points at a missing object', async () => {
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      credit_number: 'CN-2026-0001',
      pdf_storage_bucket: 'bucket',
      pdf_storage_key: 'credit-notes/stale.pdf',
      pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
    });
    storage.getPdfStream.mockImplementation(async (params) => {
      if (params.key === 'credit-notes/stale.pdf') {
        throw new NotFoundException('PDF not found in storage');
      }
      return {
        bucket: 'bucket',
        key: params.key,
        stream: {} as never,
        contentType: 'application/pdf',
        contentLength: 100,
      };
    });

    await service.getPdf(creditNoteId);

    expect(storage.getPdfStream).toHaveBeenNthCalledWith(1, {
      bucket: 'bucket',
      key: 'credit-notes/stale.pdf',
    });
    expect(storage.getPdfStream).toHaveBeenNthCalledWith(2, {
      key: 'credit-notes/credit-note-1.pdf',
    });
  });

  it('returns not generated yet when metadata and storage are missing', async () => {
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      credit_number: null,
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
    });
    storage.getPdfStream.mockRejectedValue(
      new NotFoundException('PDF not found in storage'),
    );

    await expect(service.getPdf(creditNoteId)).rejects.toThrow(
      'Credit note PDF is not generated yet',
    );
  });
});

describe('CreditNotePdfService.requestGeneration', () => {
  const tenantId = 'tenant-1';
  const creditNoteId = 'credit-note-1';

  let service: CreditNotePdfService;
  let storage: jest.Mocked<Pick<PdfStorage, 'getPdfStream'>>;
  let prisma: {
    client: {
      creditNote: {
        findFirst: jest.Mock;
        updateMany: jest.Mock;
      };
    };
  };

  beforeEach(() => {
    storage = {
      getPdfStream: jest.fn(),
    };
    prisma = {
      client: {
        creditNote: {
          findFirst: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    service = new CreditNotePdfService(
      prisma as unknown as PrismaService,
      {} as InvoicePdfRenderer,
      asFake<PdfStorage>(storage),
      asFake<CloudTasksService>({ isEnabled: jest.fn().mockReturnValue(false) }),
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
      } as unknown as TenantContextService,
    );
  });

  it('does not return cached mode when metadata exists but the GCS object is missing', async () => {
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      status: 'FINALIZED',
      site_id: 'site-1',
      credit_number: 'CN-2026-0001',
      pdf_storage_bucket: 'bucket',
      pdf_storage_key: 'credit-notes/credit-note-1.pdf',
      pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
      snapshot: {
        schema_version: 2,
        document_kind: 'CREDIT_NOTE',
        credit_title: 'Credit',
        original_document: { invoice_number: 'RE-1' },
        date: '2026-04-01',
        due_date: '2026-04-01',
        total_net: '10.00',
        total_tax: '1.90',
        total_gross: '11.90',
        tax_mode: 'STANDARD',
        customer: { name: 'Test' },
        items: [],
      },
    });
    storage.getPdfStream.mockRejectedValue(
      new NotFoundException('PDF not found in storage'),
    );

    jest
      .spyOn(service, 'generateNow')
      .mockResolvedValue({
        creditNoteId,
        bucket: 'bucket',
        key: 'credit-notes/credit-note-1.pdf',
        generatedAt: new Date('2026-04-02T00:00:00.000Z'),
      });

    const result = await service.requestGeneration(creditNoteId, {
      targetBaseUrl: 'http://localhost:3000/api/',
    });

    expect(result.mode).toBe('generated');
    expect(prisma.client.creditNote.updateMany).toHaveBeenCalledWith({
      where: { id: creditNoteId, tenant_id: tenantId },
      data: {
        pdf_storage_bucket: null,
        pdf_storage_key: null,
        pdf_generated_at: null,
      },
    });
  });

  it('refuses a SALES caller with 403 on a FINALIZED note before generating', async () => {
    const salesService = new CreditNotePdfService(
      prisma as unknown as PrismaService,
      {} as InvoicePdfRenderer,
      asFake<PdfStorage>(storage),
      asFake<CloudTasksService>({ isEnabled: jest.fn().mockReturnValue(false) }),
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'SALES' }),
      } as unknown as TenantContextService,
    );
    // FINALIZED with no cached PDF: the status gate would pass for OWNER/ADMIN, so only
    // the OWNER/ADMIN role gate can refuse this SALES caller, and it must not generate.
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      status: 'FINALIZED',
      site_id: 'site-1',
      credit_number: 'CN-2026-0001',
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
    });

    await expect(
      salesService.requestGeneration(creditNoteId, {
        targetBaseUrl: 'http://localhost:3000/api/',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.client.creditNote.updateMany).not.toHaveBeenCalled();
  });

  // AUT-986 Scenario 8: two legal entities in one tenant each use their own logo
  it('uses each legal entity own logo when two legal entities exist in one tenant', async () => {
    const { createHash } = await import('node:crypto');
    const logoA = Buffer.from('logo-entity-a');
    const logoB = Buffer.from('logo-entity-b');
    const shaA = createHash('sha256').update(logoA).digest('hex');
    const shaB = createHash('sha256').update(logoB).digest('hex');

    const renderer = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
    const uploadStorage = {
      getPdfStream: jest.fn().mockRejectedValue(new Error('not found')),
      uploadPdf: jest.fn().mockResolvedValue({ bucket: 'pdf-bucket', key: 'credit-notes/cn.pdf' }),
    };
    const brandingStorage = {
      readGeneration: jest.fn(async (_bucket: string, key: string) =>
        key === 'logos/a.png' ? logoA : logoB,
      ),
    };
    const { DEFAULT_DOCUMENT_BRAND_THEME } = await import(
      '../document-branding/theme-v1.js'
    );
    const assetIdA = '11111111-1111-4111-8111-111111111111';
    const assetIdB = '22222222-2222-4222-8222-222222222222';
    const multiPrisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          documentBrandProfile: {
            findFirst: jest.fn(async ({ where }: { where: { legal_entity_id: string } }) => {
              const assetId = where.legal_entity_id === 'le-a' ? assetIdA : assetIdB;
              return {
                id: `profile-${where.legal_entity_id}`,
                active_revision: 1,
                active_theme: {
                  ...DEFAULT_DOCUMENT_BRAND_THEME,
                  logoAssetId: assetId,
                  headerBand: 'primary',
                  headerText: where.legal_entity_id,
                  footerText: where.legal_entity_id,
                },
                active_logo_asset_id: assetId,
              };
            }),
          },
          documentBrandAsset: {
            findFirst: jest.fn(async ({ where }: { where: { legal_entity_id: string } }) =>
              where.legal_entity_id === 'le-a'
                ? {
                    id: assetIdA,
                    bucket: 'brand-bucket',
                    object_key: 'logos/a.png',
                    object_generation: '1',
                    sha256: shaA,
                    detected_mime_type: 'image/png',
                    pixel_width: 100,
                    pixel_height: 40,
                  }
                : {
                    id: assetIdB,
                    bucket: 'brand-bucket',
                    object_key: 'logos/b.png',
                    object_generation: '1',
                    sha256: shaB,
                    detected_mime_type: 'image/png',
                    pixel_width: 100,
                    pixel_height: 40,
                  },
            ),
          },
        }),
      ),
      client: {
        creditNote: {
          findFirst: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };

    const cnService = new CreditNotePdfService(
      multiPrisma as unknown as PrismaService,
      renderer as unknown as InvoicePdfRenderer,
      asFake<PdfStorage>(uploadStorage),
      asFake<CloudTasksService>({ isEnabled: jest.fn().mockReturnValue(false) }),
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
      } as unknown as TenantContextService,
      brandingStorage as never,
    );

    const baseSnapshot = {
      schema_version: 2,
      document_kind: 'CREDIT_NOTE',
      credit_title: 'Stornorechnung',
      date: '2026-10-01',
      due_date: '2026-10-01',
      total_net: '100.00',
      total_tax: '20.00',
      total_gross: '120.00',
      notes: null,
      tax_mode: 'STANDARD',
      customer: {
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Max',
        last_name: 'Muster',
        email: null,
        phone: null,
        vat_id: null,
        address_street: 'Str 1',
        address_city: 'Wien',
        address_zip: '1010',
        address_country: 'AT',
      },
      vehicle: null,
      items: [],
      snapshot_created_at: '2026-10-01T00:00:00.000Z',
      seller: { name: 'Seller', country_iso: 'AT' },
      supply_date_from: '2026-10-01',
      supply_date_to: '2026-10-01',
      payment_terms: { days: 14, text: '14 Tage' },
      currency: 'EUR',
      tax_breakdown: [],
      original_document: {
        id: 'inv-1',
        number: 'RE-1',
        date: '2026-09-01',
        reason: 'Correction',
        snapshot_version: 2,
      },
    };

    multiPrisma.client.creditNote.findFirst.mockResolvedValueOnce({
      id: 'cn-a',
      status: 'FINALIZED',
      legal_entity_id: 'le-a',
      credit_number: 'CN-A',
      snapshot: baseSnapshot,
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
    });
    await cnService.generateNow('cn-a');

    multiPrisma.client.creditNote.findFirst.mockResolvedValueOnce({
      id: 'cn-b',
      status: 'FINALIZED',
      legal_entity_id: 'le-b',
      credit_number: 'CN-B',
      snapshot: baseSnapshot,
      pdf_storage_bucket: null,
      pdf_storage_key: null,
      pdf_generated_at: null,
    });
    await cnService.generateNow('cn-b');

    expect(renderer.render).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        template_version: 'invoice-brand-v1',
        branding: expect.objectContaining({ profile_id: 'profile-le-a' }),
      }),
      { logoPng: logoA },
    );
    expect(renderer.render).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        template_version: 'invoice-brand-v1',
        branding: expect.objectContaining({ profile_id: 'profile-le-b' }),
      }),
      { logoPng: logoB },
    );
  });
});
