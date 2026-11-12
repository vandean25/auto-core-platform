import { describe, expect, it } from '@jest/globals';
import {
  isWarrantyClaimPdfArchiveStale,
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

  it('treats the archive as stale when the claim changed after generation', () => {
    const generatedAt = new Date('2026-11-12T10:00:00.000Z');
    const headerSources = {
      orderUpdatedAt: new Date('2026-11-12T09:00:00.000Z'),
      vehicleUpdatedAt: new Date('2026-11-12T09:00:00.000Z'),
      legalEntityUpdatedAt: new Date('2026-11-12T09:00:00.000Z'),
    };
    expect(
      isWarrantyClaimPdfArchiveStale({
        claimUpdatedAt: new Date('2026-11-12T12:00:00.000Z'),
        pdfGeneratedAt: generatedAt,
        ...headerSources,
      }),
    ).toBe(true);
    expect(
      isWarrantyClaimPdfArchiveStale({
        claimUpdatedAt: new Date('2026-11-12T10:00:01.000Z'),
        pdfGeneratedAt: generatedAt,
        ...headerSources,
      }),
    ).toBe(false);
  });

  it('treats the archive as stale when the workshop order changed after generation', () => {
    const generatedAt = new Date('2026-11-12T10:00:00.000Z');
    expect(
      isWarrantyClaimPdfArchiveStale({
        claimUpdatedAt: new Date('2026-11-12T09:00:00.000Z'),
        orderUpdatedAt: new Date('2026-11-12T11:00:00.000Z'),
        vehicleUpdatedAt: new Date('2026-11-12T09:00:00.000Z'),
        legalEntityUpdatedAt: new Date('2026-11-12T09:00:00.000Z'),
        pdfGeneratedAt: generatedAt,
      }),
    ).toBe(true);
  });
});
