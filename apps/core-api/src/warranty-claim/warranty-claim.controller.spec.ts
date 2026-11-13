import { Readable } from 'node:stream';
import { HEADERS_METADATA } from '@nestjs/common/constants.js';
import { InvoicesController } from '../invoices/invoices.controller.js';
import type { InvoicePdfService } from '../invoices/invoice-pdf.service.js';
import type { InvoicesService } from '../invoices/invoices.service.js';
import type { WarrantyClaimPdfService } from './warranty-claim-pdf.service.js';
import { WarrantyClaimController } from './warranty-claim.controller.js';
import type { WarrantyClaimService } from './warranty-claim.service.js';

describe('WarrantyClaimController', () => {
  let controller: WarrantyClaimController;
  let pdfService: jest.Mocked<Pick<WarrantyClaimPdfService, 'getPdf' | 'requestGeneration' | 'generateNow'>>;

  beforeEach(() => {
    pdfService = {
      getPdf: jest.fn(),
      requestGeneration: jest.fn(),
      generateNow: jest.fn(),
    };
    controller = new WarrantyClaimController(
      {} as unknown as WarrantyClaimService,
      pdfService as never,
    );
  });

  it('serves the warranty claim PDF with Content-Disposition: inline and sanitized filename', async () => {
    const stream = Readable.from(['%PDF-1.4']);
    pdfService.getPdf.mockResolvedValue({
      filename: 'garantieantrag-WO-2026-0001.pdf',
      contentType: 'application/pdf',
      contentLength: 512,
      stream,
    });

    const result = await controller.downloadPdf('order-1', 'claim-1');

    expect(pdfService.getPdf).toHaveBeenCalledWith('order-1', 'claim-1');
    expect(result.getStream()).toBe(stream);
    expect(result.getHeaders()).toEqual({
      type: 'application/pdf',
      disposition: 'inline; filename="garantieantrag-WO-2026-0001.pdf"',
      length: 512,
    });
  });

  it('matches the invoice PDF endpoint Cache-Control and Pragma response headers', () => {
    const invoicesController = new InvoicesController(
      {} as unknown as InvoicesService,
      {} as unknown as InvoicePdfService,
    );
    const warrantyHeaders = Reflect.getMetadata(
      HEADERS_METADATA,
      Object.getPrototypeOf(controller).downloadPdf as object,
    );
    const invoiceHeaders = Reflect.getMetadata(
      HEADERS_METADATA,
      Object.getPrototypeOf(invoicesController).getPdf as object,
    );

    expect(warrantyHeaders).toEqual(invoiceHeaders);
  });
});
