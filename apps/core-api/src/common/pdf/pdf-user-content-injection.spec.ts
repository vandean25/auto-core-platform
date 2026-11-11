import {
  buildInvoiceInjectionHtml,
  buildKaufvertragInjectionHtml,
  buildWarrantyClaimInjectionHtml,
  buildWorkshopEstimateInjectionHtml,
  expectPdfInjectionEscaped,
} from './pdf-user-content-injection.support.js';

describe('PDF user content injection (AUT-974)', () => {
  it('escapes script and xml payloads in the invoice template', () => {
    expectPdfInjectionEscaped(buildInvoiceInjectionHtml());
  });

  it('escapes script and xml payloads in the kaufvertrag template', () => {
    expectPdfInjectionEscaped(buildKaufvertragInjectionHtml());
  });

  it('escapes script and xml payloads in the workshop estimate template', () => {
    expectPdfInjectionEscaped(buildWorkshopEstimateInjectionHtml());
  });

  it('escapes script and xml payloads in the warranty claim template', () => {
    expectPdfInjectionEscaped(buildWarrantyClaimInjectionHtml());
  });
});
