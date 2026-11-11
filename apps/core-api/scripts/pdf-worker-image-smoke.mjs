/**
 * Minimal Playwright PDF render inside the pdf-worker image (CI smoke).
 * Uses the image-bundled Chromium under PLAYWRIGHT_BROWSERS_PATH.
 */
import { chromium } from 'playwright';

const html = `<!DOCTYPE html><html><body><p>pdf-worker smoke</p></body></html>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const pdf = await page.pdf({ format: 'A4' });
  await page.close();

  const header = Buffer.from(pdf).subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    throw new Error(`Expected PDF header, got ${JSON.stringify(header)}`);
  }
  console.log(`pdf-worker-image-smoke: ok (${pdf.length} bytes)`);
} finally {
  await browser.close();
}
