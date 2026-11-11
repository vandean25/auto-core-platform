import { escapeHtml } from './pdf-layout.js';
import {
  PDF_USER_CONTENT_INJECTION_PAYLOADS,
} from './pdf-user-content-injection.fixture.js';
import {
  buildInvoiceInjectionHtml,
  buildKaufvertragInjectionHtml,
  buildWarrantyClaimInjectionHtml,
  buildWorkshopEstimateInjectionHtml,
} from './pdf-user-content-injection.spec.support.js';

function expectPdfInjectionEscaped(html: string): void {
  for (const payload of PDF_USER_CONTENT_INJECTION_PAYLOADS) {
    expect(html).toContain(escapeHtml(payload));
    expect(html).not.toContain(payload);
  }
  expect(html).not.toMatch(/<script[\s>]/i);
  expect(html).not.toMatch(/<\?xml/i);
}

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
