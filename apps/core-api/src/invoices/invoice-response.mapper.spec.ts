import { omitInvoiceSnapshot } from './invoice-response.mapper.js';

describe('omitInvoiceSnapshot', () => {
  it('does not expose private snapshot data in an API response', () => {
    const response = omitInvoiceSnapshot({
      id: 'invoice-1',
      status: 'FINALIZED',
      snapshot: {
        branding: {
          logo: {
            bucket: 'private-bucket',
            key: 'private/object.png',
            generation: '123',
          },
        },
      },
    });

    expect(response).toEqual({ id: 'invoice-1', status: 'FINALIZED' });
    expect(JSON.stringify(response)).not.toContain('private-bucket');
    expect(JSON.stringify(response)).not.toContain('private/object.png');
  });

  it('does not expose archive or legacy storage locators in an API response', () => {
    const response = omitInvoiceSnapshot({
      id: 'invoice-1',
      status: 'ISSUED',
      snapshot: { private: 'snapshot-value' },
      pdf_archive_bucket: 'private-archive-bucket',
      pdf_archive_key: 'private/archive/key.pdf',
      pdf_archive_generation: 'private-generation',
      pdf_archive_sha256: 'private-hash',
      pdf_storage_bucket: 'private-legacy-bucket',
      pdf_storage_key: 'private/legacy/key.pdf',
    });

    const serialized = JSON.stringify(response);
    expect(response).toEqual({ id: 'invoice-1', status: 'ISSUED' });
    expect(serialized).not.toContain('snapshot');
    expect(serialized).not.toContain('private-archive-bucket');
    expect(serialized).not.toContain('private/archive/key.pdf');
    expect(serialized).not.toContain('private-generation');
    expect(serialized).not.toContain('private-hash');
    expect(serialized).not.toContain('private-legacy-bucket');
    expect(serialized).not.toContain('private/legacy/key.pdf');
  });
});
