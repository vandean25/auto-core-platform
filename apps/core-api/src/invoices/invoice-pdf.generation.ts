import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';

export type CachedPdfMetadata = {
  bucket: string;
  key: string;
  generatedAt: Date;
};

type InvoicePdfCacheFields = {
  pdf_storage_bucket: string | null;
  pdf_storage_key: string | null;
  pdf_generated_at: Date | null;
};

export const readCachedPdfMetadata = (
  invoice: InvoicePdfCacheFields,
): CachedPdfMetadata | null => {
  if (
    !invoice.pdf_storage_key ||
    !invoice.pdf_storage_bucket ||
    !invoice.pdf_generated_at
  ) {
    return null;
  }

  return {
    bucket: invoice.pdf_storage_bucket,
    key: invoice.pdf_storage_key,
    generatedAt: invoice.pdf_generated_at,
  };
};

export const assertInvoicePdfGenerationAllowed = (status: InvoiceStatus) => {
  if (status !== InvoiceStatus.ISSUED && status !== InvoiceStatus.PAID) {
    throw new BadRequestException(
      'Invoice PDF can only be generated for ISSUED/PAID invoices',
    );
  }
};
