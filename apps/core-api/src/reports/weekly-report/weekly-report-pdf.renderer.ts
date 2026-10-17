import { Injectable, Logger } from '@nestjs/common';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../../common/index.js';
import { escapeHtml } from '../../common/pdf/pdf-layout.js';
import { loadBundledBrandFontCss } from '../../document-branding/bundled-brand-font-css.js';
import type { WeeklyReportData } from './weekly-report-data.service.js';
import { buildWeeklyReportHtmlDocument } from './weekly-report-pdf.layout.js';

@Injectable()
export class WeeklyReportPdfRenderer {
  private readonly logger = new Logger(WeeklyReportPdfRenderer.name);
  private readonly assetDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../document-branding/assets',
  );

  constructor(private readonly browserService: PlaywrightBrowserService) {}

  async render(data: WeeklyReportData, logoPng?: Buffer): Promise<Buffer> {
    const fontFaceCss =
      (await loadBundledBrandFontCss(this.assetDirectory)) ?? '';
    const logoDataUrl = logoPng
      ? `data:image/png;base64,${logoPng.toString('base64')}`
      : null;

    return Sentry.startSpan(
      { name: 'Render Weekly Report PDF', op: 'pdf.render' },
      async () => {
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();
        try {
          await page.route(/^https?:\/\//, (route) => route.abort());
          const html = buildWeeklyReportHtmlDocument(
            data,
            fontFaceCss,
            escapeHtml,
            logoDataUrl,
          );
          await page.setContent(html, { timeout: 15_000 });
          return await this.browserService.withTimeout(
            page.pdf({
              format: 'A4',
              margin: {
                top: '16mm',
                right: '14mm',
                bottom: '16mm',
                left: '14mm',
              },
              printBackground: true,
            }),
            30_000,
            'Weekly report PDF render timed out',
          );
        } finally {
          await page.close().catch((error) => {
            this.logger.warn(
              `Failed to close weekly report PDF page: ${error}`,
            );
          });
        }
      },
    );
  }
}
