import { ServiceUnavailableException } from '@nestjs/common';
import { DisabledDocumentBrandingExtractionProvider } from './document-branding-extraction-provider.js';

describe('DisabledDocumentBrandingExtractionProvider', () => {
  it('reports unavailable until an approved production adapter is configured', () => {
    const provider = new DisabledDocumentBrandingExtractionProvider();

    expect(provider.isAvailable()).toBe(false);
  });

  it('rejects extraction without making an outbound provider request', async () => {
    const provider = new DisabledDocumentBrandingExtractionProvider();

    await expect(
      provider.extract({
        normalizedFirstPagePng: Buffer.from('normalized-image'),
        promptVersion: 'document-branding-v1',
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
