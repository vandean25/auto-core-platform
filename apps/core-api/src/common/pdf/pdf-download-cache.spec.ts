import { applyPdfDownloadCacheControlIfNeeded, isPdfDownloadGetRequest } from './pdf-download-cache.js';

describe('pdf-download-cache', () => {
  it('detects GET pdf download routes', () => {
    expect(
      isPdfDownloadGetRequest({
        method: 'GET',
        path: '/api/credit-notes/abc/pdf',
      } as never),
    ).toBe(true);
    expect(
      isPdfDownloadGetRequest({
        method: 'POST',
        path: '/api/credit-notes/abc/pdf',
      } as never),
    ).toBe(false);
    expect(
      isPdfDownloadGetRequest({
        method: 'GET',
        path: '/api/credit-notes/abc',
      } as never),
    ).toBe(false);
  });

  it('sets no-store headers for GET pdf routes', () => {
    const headers: Record<string, string> = {};
    const response = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    };

    applyPdfDownloadCacheControlIfNeeded(
      { method: 'GET', path: '/api/invoices/abc/pdf' } as never,
      response as never,
    );

    expect(headers).toEqual({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    });
  });
});
