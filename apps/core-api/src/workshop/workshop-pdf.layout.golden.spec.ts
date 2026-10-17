import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import { buildWorkshopHtmlDocument } from './workshop-pdf.layout.js';
import {
  CHECK_IN_PHOTO_DATA_URL,
  CHECK_IN_SIGNATURE_DATA_URL,
  buildWorkshopPdfFixtureOrder,
  buildWorkshopPdfFixtureOrderWithCheckIn,
} from './workshop-pdf.fixture.js';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

function readGolden(name: string): string {
  return readFileSync(`${fixturesDir}/${name}`, 'utf8');
}

describe('workshop-pdf.layout golden HTML', () => {
  it('matches the baseline job card without a completed check-in', () => {
    const order = buildWorkshopPdfFixtureOrder();
    const html = buildWorkshopHtmlDocument(
      order,
      order.order_number,
      escapeHtml,
      'de',
    );

    expect(html).toBe(readGolden('workshop-pdf-order-baseline.golden.html'));
    expect(html).not.toContain('class="section check-in-section"');
    expect(html).not.toContain('Fahrzeugannahme');
  });

  it('matches the job card with a completed check-in section', () => {
    const order = buildWorkshopPdfFixtureOrderWithCheckIn();
    const html = buildWorkshopHtmlDocument(
      order,
      order.order_number,
      escapeHtml,
      'de',
    );

    expect(html).toBe(readGolden('workshop-pdf-order-with-check-in.golden.html'));
    expect(html).toContain('check-in-section');
    expect(html).toContain('Fahrzeugannahme');
    expect(html).toContain(CHECK_IN_SIGNATURE_DATA_URL);
    expect(html.split(CHECK_IN_PHOTO_DATA_URL).length - 1).toBe(1);
  });
});
