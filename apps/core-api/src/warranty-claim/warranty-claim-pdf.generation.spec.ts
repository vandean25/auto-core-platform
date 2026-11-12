import { describe, expect, it } from '@jest/globals';
import {
  readCachedWarrantyClaimPdfMetadata,
  warrantyClaimPdfObjectKey,
} from './warranty-claim-pdf.generation.js';

describe('warranty-claim-pdf.generation', () => {
  it('builds a stable object key per claim', () => {
    expect(warrantyClaimPdfObjectKey('claim-1')).toBe(
      'warranty-claims/claim-1.pdf',
    );
  });

  it('reads cached metadata only when archive fields are complete', () => {
    expect(
      readCachedWarrantyClaimPdfMetadata({
        pdf_storage_bucket: 'bucket',
        pdf_storage_key: 'key',
        pdf_generated_at: new Date('2026-11-12T00:00:00.000Z'),
        pdf_generation_error: null,
      }),
    ).toMatchObject({
      bucket: 'bucket',
      key: 'key',
    });

    expect(
      readCachedWarrantyClaimPdfMetadata({
        pdf_storage_bucket: null,
        pdf_storage_key: null,
        pdf_generated_at: null,
        pdf_generation_error: 'failed',
      }),
    ).toBeNull();
  });
});
