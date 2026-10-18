import {
  emailLocaleString,
  loadEmailLocaleJson,
} from './email-locale-test-helpers.js';
import { createEmailTranslator } from './email-i18n.js';
import { createPdfTranslator } from './pdf-i18n.js';
import { loadPdfLocaleJson, pdfLocaleString } from './pdf-locale-test-helpers.js';

describe('pdf and email i18n isolation', () => {
  const enPdf = loadPdfLocaleJson('en');
  const enEmail = loadEmailLocaleJson('en');
  const enPdfTitle = pdfLocaleString(enPdf, 'estimate.title');
  const enEmailSubject = emailLocaleString(
    enEmail,
    'customer.orderReady.subject',
  );

  function expectPdfAndEmailBundles() {
    expect(createPdfTranslator('en')('estimate.title')).toBe(enPdfTitle);
    expect(
      createEmailTranslator('en')('customer.orderReady.subject', {
        orderNumber: 'WO-1',
      }),
    ).toBe(enEmailSubject.replace('{{orderNumber}}', 'WO-1'));
  }

  it('keeps pdf and email bundles when pdf is initialized before email', () => {
    expectPdfAndEmailBundles();
  });

  it('keeps pdf and email bundles when email is initialized before pdf', () => {
    expect(
      createEmailTranslator('de')('shared.defaultGreeting'),
    ).toBeTruthy();
    expect(createPdfTranslator('de')('estimate.title')).toBeTruthy();
    expectPdfAndEmailBundles();
  });
});
