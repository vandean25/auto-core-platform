import { PDF_READ_LINK_MAX_TTL_SECONDS, PdfStorage } from './pdf-storage.js';

describe('PdfStorage read links', () => {
  const NOW = new Date('2026-10-10T10:00:00.000Z');
  const FIFTEEN_MINUTES_MS = PDF_READ_LINK_MAX_TTL_SECONDS * 1000;
  const originalBucket = process.env.INVOICE_PDF_BUCKET;
  let service: PdfStorage;
  let getSignedUrl: jest.Mock;
  let bucket: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    process.env.INVOICE_PDF_BUCKET = 'invoice-pdf-test';
    getSignedUrl = jest
      .fn()
      .mockResolvedValue(['https://storage.example.test/signed']);
    bucket = jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({ getSignedUrl }),
    });
    service = new PdfStorage();
    Object.defineProperty(service, 'storage', { value: { bucket } });
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalBucket === undefined) {
      delete process.env.INVOICE_PDF_BUCKET;
    } else {
      process.env.INVOICE_PDF_BUCKET = originalBucket;
    }
  });

  it('signs a v4 read link for the row-scoped bucket and key, expiring in at most 15 minutes', async () => {
    const link = await service.createSignedReadUrl({
      bucket: 'invoice-pdf-test',
      key: 'invoices/tenant-1/invoice-1.pdf',
      filename: 'invoice-RE-2026-1001.pdf',
    });

    expect(bucket).toHaveBeenCalledWith('invoice-pdf-test');
    expect(getSignedUrl).toHaveBeenCalledWith({
      version: 'v4',
      action: 'read',
      expires: new Date(NOW.getTime() + FIFTEEN_MINUTES_MS),
      responseType: 'application/pdf',
      responseDisposition: 'inline; filename="invoice-RE-2026-1001.pdf"',
    });
    expect(link).toEqual({
      url: 'https://storage.example.test/signed',
      expiresAt: new Date(NOW.getTime() + FIFTEEN_MINUTES_MS),
    });
  });

  it('clamps a longer requested lifetime to the 15-minute ceiling', async () => {
    const link = await service.createSignedReadUrl({
      bucket: 'invoice-pdf-test',
      key: 'k.pdf',
      filename: 'k.pdf',
      ttlSeconds: 60 * 60,
    });

    expect(link.expiresAt.getTime() - NOW.getTime()).toBe(FIFTEEN_MINUTES_MS);
    expect(getSignedUrl.mock.calls[0][0].expires.getTime()).toBe(
      NOW.getTime() + FIFTEEN_MINUTES_MS,
    );
  });

  it('keeps at least one whole second for a zero or fractional lifetime', async () => {
    const link = await service.createSignedReadUrl({
      key: 'k.pdf',
      filename: 'k.pdf',
      ttlSeconds: 0.4,
    });

    expect(link.expiresAt.getTime() - NOW.getTime()).toBe(1000);
  });

  it('falls back to the configured PDF bucket when the row has none', async () => {
    await service.createSignedReadUrl({
      key: 'legacy/k.pdf',
      filename: 'k.pdf',
    });

    expect(bucket).toHaveBeenCalledWith('invoice-pdf-test');
  });

  it('keeps quotes and line breaks out of the download filename', async () => {
    await service.createSignedReadUrl({
      bucket: 'invoice-pdf-test',
      key: 'k.pdf',
      filename: 'a"b\r\nc.pdf',
    });

    expect(getSignedUrl.mock.calls[0][0].responseDisposition).toBe(
      'inline; filename="a_b_c.pdf"',
    );
  });

  it('turns a signing failure into a generic error without the key or any URL', async () => {
    getSignedUrl.mockRejectedValueOnce(new Error('signBlob denied'));

    await expect(
      service.createSignedReadUrl({
        bucket: 'invoice-pdf-test',
        key: 'k.pdf',
        filename: 'k.pdf',
      }),
    ).rejects.toThrow('Failed to create PDF download link');
  });
});
