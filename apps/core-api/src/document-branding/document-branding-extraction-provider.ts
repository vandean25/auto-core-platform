import { ServiceUnavailableException } from '@nestjs/common';

export const DOCUMENT_BRAND_EXTRACTION_PROVIDER = Symbol(
  'DOCUMENT_BRAND_EXTRACTION_PROVIDER',
);

export const DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION = 'document-branding-v1';

export type DocumentBrandingExtractionInput = {
  normalizedFirstPagePng: Buffer;
  promptVersion: string;
  signal: AbortSignal;
};

export interface DocumentBrandingExtractionProvider {
  isAvailable(): boolean;
  getMetadata(): { providerId: string; modelId: string };
  extract(input: DocumentBrandingExtractionInput): Promise<unknown>;
}

export class DisabledDocumentBrandingExtractionProvider implements DocumentBrandingExtractionProvider {
  isAvailable(): boolean {
    return false;
  }

  getMetadata(): { providerId: string; modelId: string } {
    return { providerId: 'disabled', modelId: 'none' };
  }

  extract(): Promise<unknown> {
    return Promise.reject(
      new ServiceUnavailableException({
        code: 'BRAND_EXTRACTION_UNAVAILABLE',
        message: 'Letterhead extraction is not currently available.',
      }),
    );
  }
}
