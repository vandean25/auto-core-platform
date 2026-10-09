import { omitKaufvertragArchiveInternals } from './kaufvertrag-sale-response.js';

describe('omitKaufvertragArchiveInternals', () => {
  it('removes the snapshot and the archive pointer but keeps the status fields the page reads', () => {
    const generatedAt = new Date('2026-10-09T10:00:00.000Z');
    const sale = {
      id: 'sale-1',
      sale_number: 'VS-2026-0001',
      garantie_months: 12,
      kaufvertrag_snapshot: { seller: { name: 'Demo Autohaus GmbH' } },
      kaufvertrag_snapshot_sha256: 'a'.repeat(64),
      kaufvertrag_archive_bucket: 'pdf-archive-bucket',
      kaufvertrag_archive_key:
        'vehicle-sale-kaufvertrag-archives/tenant-1/sale-1/aaaa/kaufvertrag-brand-v1.pdf',
      kaufvertrag_archive_generation: '101',
      kaufvertrag_archive_sha256: 'b'.repeat(64),
      kaufvertrag_generated_at: generatedAt,
      kaufvertrag_generation_error: null,
    };

    const response = omitKaufvertragArchiveInternals(sale);

    expect(response).toEqual({
      id: 'sale-1',
      sale_number: 'VS-2026-0001',
      garantie_months: 12,
      kaufvertrag_generated_at: generatedAt,
      kaufvertrag_generation_error: null,
    });
    expect(sale.kaufvertrag_snapshot).toEqual({
      seller: { name: 'Demo Autohaus GmbH' },
    });
  });
});
