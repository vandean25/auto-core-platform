import { readCachedWorkshopPdfMetadata } from './workshop-pdf.generation';

describe('readCachedWorkshopPdfMetadata', () => {
  const generatedAt = new Date('2026-04-01T12:00:00.000Z');
  const freshUpdatedAt = new Date('2026-04-01T11:59:00.000Z');
  const staleUpdatedAt = new Date('2026-04-01T12:05:00.000Z');

  it('returns null if pdf_storage_key is missing', () => {
    expect(
      readCachedWorkshopPdfMetadata({
        pdf_storage_bucket: 'bucket',
        pdf_storage_key: null,
        pdf_generated_at: generatedAt,
        updatedAt: freshUpdatedAt,
      }),
    ).toBeNull();
  });

  it('returns null if pdf_storage_bucket is missing', () => {
    expect(
      readCachedWorkshopPdfMetadata({
        pdf_storage_bucket: null,
        pdf_storage_key: 'key.pdf',
        pdf_generated_at: generatedAt,
        updatedAt: freshUpdatedAt,
      }),
    ).toBeNull();
  });

  it('returns null if pdf_generated_at is missing', () => {
    expect(
      readCachedWorkshopPdfMetadata({
        pdf_storage_bucket: 'bucket',
        pdf_storage_key: 'key.pdf',
        pdf_generated_at: null,
        updatedAt: freshUpdatedAt,
      }),
    ).toBeNull();
  });

  it('returns null if the order was updated significantly after generation', () => {
    expect(
      readCachedWorkshopPdfMetadata({
        pdf_storage_bucket: 'bucket',
        pdf_storage_key: 'key.pdf',
        pdf_generated_at: generatedAt,
        updatedAt: staleUpdatedAt,
      }),
    ).toBeNull();
  });

  it('returns cached metadata if order was updated before generation', () => {
    expect(
      readCachedWorkshopPdfMetadata({
        pdf_storage_bucket: 'bucket',
        pdf_storage_key: 'workshop-orders/123.pdf',
        pdf_generated_at: generatedAt,
        updatedAt: freshUpdatedAt,
      }),
    ).toEqual({
      bucket: 'bucket',
      key: 'workshop-orders/123.pdf',
      generatedAt,
    });
  });

  it('returns cached metadata if order update is within the 2-second grace period', () => {
    const slightlyLaterUpdatedAt = new Date(generatedAt.getTime() + 1000);
    expect(
      readCachedWorkshopPdfMetadata({
        pdf_storage_bucket: 'bucket',
        pdf_storage_key: 'workshop-orders/123.pdf',
        pdf_generated_at: generatedAt,
        updatedAt: slightlyLaterUpdatedAt,
      }),
    ).toEqual({
      bucket: 'bucket',
      key: 'workshop-orders/123.pdf',
      generatedAt,
    });
  });
});
