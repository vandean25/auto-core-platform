import { UnprocessableEntityException } from '@nestjs/common';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';
import { parseDocumentBrandingExtractionResponse } from './document-branding-extraction-response.js';

describe('parseDocumentBrandingExtractionResponse', () => {
  it('returns a complete theme with the bounded crop suggestion and warnings', () => {
    const result = parseDocumentBrandingExtractionResponse(validResponse());

    expect(result).toEqual({
      theme: {
        ...DEFAULT_DOCUMENT_BRAND_THEME,
        primaryColor: '#123456',
        secondaryColor: '#E5E7EB',
        headerText: 'Auto Core',
      },
      warningCodes: ['PDF_ADDITIONAL_PAGES_IGNORED'],
      cropRect: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
    });
  });

  it.each([
    ['unknown fields', { ...validResponse(), downloadUrl: 'https://example.test' }],
    ['an injected asset identifier', { ...validResponse(), logoAssetId: 'asset-1' }],
    ['malformed JSON', '{"confidence":'],
    ['invalid color tokens', withTheme({ primaryColor: 'red' })],
    ['markup in decorative text', withTheme({ headerText: '<img src=x>' })],
    ['format controls in text', withTheme({ headerText: 'Auto\u202E Core' })],
    ['oversized decorative text', withTheme({ headerText: 'x'.repeat(121) })],
    [
      'an out-of-bounds crop rectangle',
      { ...validResponse(), cropRect: { x: 0.5, y: 0, width: 0.6, height: 1 } },
    ],
    ['a low-confidence result', { ...validResponse(), confidence: 'LOW' }],
  ])('rejects %s', (_description, response) => {
    expect(() => parseDocumentBrandingExtractionResponse(response)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects structured output over the provider response limit', () => {
    expect(() =>
      parseDocumentBrandingExtractionResponse(
        withTheme({ footerText: 'x'.repeat(8_100) }),
      ),
    ).toThrow(UnprocessableEntityException);
  });
});

function validResponse() {
  return {
    confidence: 'SUFFICIENT',
    theme: {
      schemaVersion: 1,
      presetId: 'standard-v1',
      primaryColor: '#123456',
      secondaryColor: '#E5E7EB',
      fontId: 'acp-sans-v1',
      headerBand: 'none',
      footerBand: 'none',
      headerText: 'Auto Core',
      footerText: '',
    },
    warningCodes: ['PDF_ADDITIONAL_PAGES_IGNORED'],
    cropRect: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
  };
}

function withTheme(theme: Record<string, unknown>) {
  return { ...validResponse(), theme: { ...validResponse().theme, ...theme } };
}
