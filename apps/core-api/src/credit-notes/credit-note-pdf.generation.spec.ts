import {
  buildCreditNotePdfStorageCandidates,
  creditNotePdfObjectKey,
  isCreditNotePdfGenerationComplete,
  readCachedCreditNotePdfMetadata,
} from './credit-note-pdf.generation.js';

describe('credit-note-pdf.generation', () => {
  describe('readCachedCreditNotePdfMetadata', () => {
    it('returns metadata when all cache fields are present', () => {
      const generatedAt = new Date('2026-04-01T00:00:00.000Z');

      expect(
        readCachedCreditNotePdfMetadata({
          pdf_storage_bucket: 'bucket',
          pdf_storage_key: 'credit-notes/cn-1.pdf',
          pdf_generated_at: generatedAt,
        }),
      ).toEqual({
        bucket: 'bucket',
        key: 'credit-notes/cn-1.pdf',
        generatedAt,
      });
    });

    it('returns null when any cache field is missing', () => {
      expect(
        readCachedCreditNotePdfMetadata({
          pdf_storage_bucket: 'bucket',
          pdf_storage_key: null,
          pdf_generated_at: new Date(),
        }),
      ).toBeNull();
    });
  });

  describe('isCreditNotePdfGenerationComplete', () => {
    it('is true when pdf_generated_at is set and there is no error', () => {
      expect(
        isCreditNotePdfGenerationComplete({
          pdf_storage_bucket: null,
          pdf_storage_key: null,
          pdf_generated_at: new Date(),
          pdf_generation_error: null,
        }),
      ).toBe(true);
    });

    it('is false when pdf_generation_error is set', () => {
      expect(
        isCreditNotePdfGenerationComplete({
          pdf_storage_bucket: 'bucket',
          pdf_storage_key: 'credit-notes/cn-1.pdf',
          pdf_generated_at: new Date(),
          pdf_generation_error: 'Renderer failed',
        }),
      ).toBe(false);
    });
  });

  describe('buildCreditNotePdfStorageCandidates', () => {
    it('includes cached, partial, and canonical keys without duplicates', () => {
      const creditNoteId = 'cn-1';
      const canonicalKey = creditNotePdfObjectKey(creditNoteId);

      expect(
        buildCreditNotePdfStorageCandidates(
          {
            pdf_storage_bucket: 'bucket',
            pdf_storage_key: canonicalKey,
            pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
          },
          creditNoteId,
        ),
      ).toEqual([{ bucket: 'bucket', key: canonicalKey }]);
    });

    it('falls back to canonical key when only pdf_generated_at is present', () => {
      const creditNoteId = 'cn-2';

      expect(
        buildCreditNotePdfStorageCandidates(
          {
            pdf_storage_bucket: null,
            pdf_storage_key: null,
            pdf_generated_at: new Date('2026-04-01T00:00:00.000Z'),
          },
          creditNoteId,
        ),
      ).toEqual([{ key: creditNotePdfObjectKey(creditNoteId) }]);
    });
  });
});
