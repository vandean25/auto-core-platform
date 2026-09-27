import { NotFoundException } from '@nestjs/common';
import { CreditNotePdfService } from './credit-note-pdf.service.js';
import type { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { InvoicePdfRenderer } from '../invoices/invoice-pdf.renderer.js';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';

describe('CreditNotePdfService.getPdf', () => {
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
      storage,
      {} as CloudTasksService,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
    );
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
      storage,
      { isEnabled: jest.fn().mockReturnValue(false) } as CloudTasksService,
      {
        getTenantId: jest.fn().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
    );
  });

  it('does not return cached mode when metadata exists but the GCS object is missing', async () => {
    prisma.client.creditNote.findFirst.mockResolvedValue({
      id: creditNoteId,
      status: 'FINALIZED',
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
});
