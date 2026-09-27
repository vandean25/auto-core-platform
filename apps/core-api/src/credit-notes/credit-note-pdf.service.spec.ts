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
