import {
  DisabledRegistrationDocumentExtractionProvider,
  type RegistrationDocumentExtractionProvider,
} from './registration-document-extraction-provider.js';
import { FakeRegistrationDocumentExtractionProvider } from './fake-registration-document-extraction-provider.js';

export type RegistrationDocumentExtractionProviderId = 'disabled' | 'fake';

export function readRegistrationDocumentExtractionProviderId(
  env: NodeJS.ProcessEnv = process.env,
): RegistrationDocumentExtractionProviderId {
  const raw =
    env.REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER?.trim().toLowerCase();
  if (raw === 'fake') {
    if (env.NODE_ENV === 'production') {
      return 'disabled';
    }
    return 'fake';
  }
  return 'disabled';
}

export function createRegistrationDocumentExtractionProvider(
  env: NodeJS.ProcessEnv = process.env,
): RegistrationDocumentExtractionProvider {
  const providerId = readRegistrationDocumentExtractionProviderId(env);
  if (providerId === 'fake') {
    return new FakeRegistrationDocumentExtractionProvider();
  }
  return new DisabledRegistrationDocumentExtractionProvider();
}
