import { InternalServerErrorException } from '@nestjs/common';
import { resolvePdfStorageBucket } from './pdf-bucket';

describe('resolvePdfStorageBucket', () => {
  it('returns INVOICE_PDF_BUCKET for invoice and workshop job-card storage', () => {
    expect(
      resolvePdfStorageBucket({ INVOICE_PDF_BUCKET: 'acp-invoice-pdfs' }),
    ).toBe('acp-invoice-pdfs');
  });

  it('throws when INVOICE_PDF_BUCKET is missing', () => {
    expect(() => resolvePdfStorageBucket({})).toThrow(
      InternalServerErrorException,
    );
    expect(() => resolvePdfStorageBucket({})).toThrow(
      'INVOICE_PDF_BUCKET environment variable is not configured',
    );
  });

  it('throws when INVOICE_PDF_BUCKET is blank', () => {
    expect(() =>
      resolvePdfStorageBucket({ INVOICE_PDF_BUCKET: '   ' }),
    ).toThrow(InternalServerErrorException);
  });
});
