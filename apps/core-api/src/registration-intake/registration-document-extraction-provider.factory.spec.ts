import {
  createRegistrationDocumentExtractionProvider,
  readRegistrationDocumentExtractionProviderId,
} from './registration-document-extraction-provider.factory.js';

describe('registration document extraction provider factory', () => {
  it('defaults to disabled', () => {
    expect(
      readRegistrationDocumentExtractionProviderId({ NODE_ENV: 'test' }),
    ).toBe('disabled');
    expect(
      createRegistrationDocumentExtractionProvider({ NODE_ENV: 'test' })
        .getMetadata()
        .providerId,
    ).toBe('disabled');
  });

  it('allows fake outside production', () => {
    expect(
      readRegistrationDocumentExtractionProviderId({
        NODE_ENV: 'development',
        REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER: 'fake',
      }),
    ).toBe('fake');
  });

  it('refuses fake in production', () => {
    expect(
      readRegistrationDocumentExtractionProviderId({
        NODE_ENV: 'production',
        REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER: 'fake',
      }),
    ).toBe('disabled');
    expect(
      createRegistrationDocumentExtractionProvider({
        NODE_ENV: 'production',
        REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER: 'fake',
      })
        .getMetadata()
        .providerId,
    ).toBe('disabled');
  });
});
