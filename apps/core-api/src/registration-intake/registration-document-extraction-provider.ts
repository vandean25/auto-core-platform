import { ServiceUnavailableException } from '@nestjs/common';
import type {
  RegistrationDocumentKind,
  RegistrationFieldEvidence,
  RegistrationProviderWarning,
} from './registration-document-extraction.types.js';
import { REGISTRATION_DOCUMENT_PROMPT_VERSION } from './registration-document-extraction.types.js';

export const REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER = Symbol(
  'REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER',
);

export interface RegistrationDocumentExtractionProvider {
  isAvailable(): boolean;
  getMetadata(): { providerId: string; modelId: string };
  extract(input: {
    pages: { page: number; png: Buffer }[];
    promptVersion: typeof REGISTRATION_DOCUMENT_PROMPT_VERSION;
    signal: AbortSignal;
  }): Promise<{
    documentKind: RegistrationDocumentKind;
    warnings: RegistrationProviderWarning[];
    fields: Record<string, RegistrationFieldEvidence>;
  }>;
}

export class DisabledRegistrationDocumentExtractionProvider implements RegistrationDocumentExtractionProvider {
  isAvailable(): boolean {
    return false;
  }

  getMetadata(): { providerId: string; modelId: string } {
    return { providerId: 'disabled', modelId: 'none' };
  }

  extract(): Promise<{
    documentKind: RegistrationDocumentKind;
    warnings: RegistrationProviderWarning[];
    fields: Record<string, RegistrationFieldEvidence>;
  }> {
    return Promise.reject(
      new ServiceUnavailableException({
        code: 'REGISTRATION_EXTRACTION_UNAVAILABLE',
        message:
          'REGISTRATION_EXTRACTION_UNAVAILABLE: Registration document extraction is not currently available.',
      }),
    );
  }
}
