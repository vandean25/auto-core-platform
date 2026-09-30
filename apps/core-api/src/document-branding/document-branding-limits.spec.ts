import {
  DOCUMENT_BRAND_DECORATIVE_TEXT_MAX_CODE_POINTS,
  documentBrandProfileCapabilities,
  formatLogoUploadRequirement,
  logoFileInputAccept,
} from './document-branding-limits.js';

describe('document branding limits', () => {
  it('exposes profile capabilities for the settings UI', () => {
    expect(documentBrandProfileCapabilities(false)).toMatchObject({
      extractionAvailable: false,
      theme: {
        decorativeTextMaxCodePoints:
          DOCUMENT_BRAND_DECORATIVE_TEXT_MAX_CODE_POINTS,
      },
      uploads: {
        logo: {
          accept: logoFileInputAccept(),
          requirementLabel: formatLogoUploadRequirement(),
        },
      },
    });
  });
});
