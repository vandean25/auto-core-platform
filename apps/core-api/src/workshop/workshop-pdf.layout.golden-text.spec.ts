import { extractVisibleTextFromHtml } from '../common/pdf/pdf-html-text.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import { buildWorkshopHtmlDocument } from './workshop-pdf.layout.js';
import { buildWorkshopPdfFixtureOrder } from './workshop-pdf.fixture.js';

describe('workshop-pdf.layout golden text', () => {
  it('matches the German job card text baseline in legacy mode', () => {
    const order = buildWorkshopPdfFixtureOrder();
    const html = buildWorkshopHtmlDocument(
      order,
      order.order_number,
      escapeHtml,
      'de',
      'legacy',
    );
    const text = extractVisibleTextFromHtml(html);
    expect(text).toContain('Arbeitskarte');
    expect(text).toContain('Gemeldetes Problem / Kundenbeanstandung');
    expect(text).not.toContain('Job Card');
  });

  it('matches the English job card text when localized', () => {
    const order = buildWorkshopPdfFixtureOrder();
    const html = buildWorkshopHtmlDocument(
      order,
      order.order_number,
      escapeHtml,
      'en',
      'localized',
    );
    const text = extractVisibleTextFromHtml(html);
    expect(text).toContain('Job Card');
    expect(text).toContain('Reported Issue / Customer Complaint');
    expect(text).toContain(
      'The German version of the legal texts is authoritative',
    );
    expect(text).not.toContain('Arbeitskarte');
  });
});
