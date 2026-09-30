import { ServiceUnavailableException } from '@nestjs/common';
import type {
  DocumentBrandingExtractionInput,
  DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';

/**
 * Placeholder for Gemini-on-Vertex extraction (customer data, ADC auth).
 * Not enabled until product/operations approves region, model, and data terms.
 */
export class VertexDocumentBrandingExtractionProvider implements DocumentBrandingExtractionProvider {
  isAvailable(): boolean {
    return false;
  }

  getMetadata(): { providerId: string; modelId: string } {
    return { providerId: 'vertex', modelId: 'pending-activation' };
  }

  extract(input: DocumentBrandingExtractionInput): Promise<unknown> {
    void input;
    return Promise.reject(
      new ServiceUnavailableException({
        code: 'BRAND_EXTRACTION_UNAVAILABLE',
        message: 'Letterhead extraction is not currently available.',
      }),
    );
  }
}
