import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import {
  assertInvoicePdfGenerationAllowed,
  readCachedPdfMetadata,
} from './invoice-pdf.generation';

describe('invoice-pdf.generation', () => {
  describe('readCachedPdfMetadata', () => {
    it('returns metadata when all cache fields are present', () => {
      const generatedAt = new Date('2026-04-01T00:00:00.000Z');

      expect(
        readCachedPdfMetadata({
          pdf_storage_bucket: 'bucket',
          pdf_storage_key: 'invoices/inv-1.pdf',
          pdf_generated_at: generatedAt,
        }),
      ).toEqual({
        bucket: 'bucket',
        key: 'invoices/inv-1.pdf',
        generatedAt,
      });
    });

    it('returns null when any cache field is missing', () => {
      expect(
        readCachedPdfMetadata({
          pdf_storage_bucket: 'bucket',
          pdf_storage_key: null,
          pdf_generated_at: new Date(),
        }),
      ).toBeNull();
    });
  });

  describe('assertInvoicePdfGenerationAllowed', () => {
    it('allows ISSUED and PAID invoices', () => {
      expect(() =>
        assertInvoicePdfGenerationAllowed(InvoiceStatus.ISSUED),
      ).not.toThrow();
      expect(() =>
        assertInvoicePdfGenerationAllowed(InvoiceStatus.PAID),
      ).not.toThrow();
    });

    it('rejects other invoice statuses', () => {
      expect(() =>
        assertInvoicePdfGenerationAllowed(InvoiceStatus.DRAFT),
      ).toThrow(BadRequestException);
    });
  });
});
