import { UnprocessableEntityException } from '@nestjs/common';
import { WorkshopEstimatePdfRenderer } from './workshop-estimate-pdf.renderer.js';
import {
  buildEstimateSnapshot,
  estimateBrandingFixture,
} from './workshop-estimate.spec.support.js';

const PDF_BYTES = Buffer.from('%PDF-1.4 renderer fixture');
const LOGO_BYTES = Buffer.from('frozen logo fixture');
const LOGO_FIXTURE = {
  asset_id: 'asset-1',
  bucket: 'brand-assets',
  key: 'logos/asset-1.png',
  generation: '17',
  sha256: 'a'.repeat(64),
  mime_type: 'image/png' as const,
  width: 120,
  height: 40,
};

function buildRenderer() {
  const page = {
    route: jest.fn().mockResolvedValue(undefined),
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(PDF_BYTES),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const browser = { newPage: jest.fn().mockResolvedValue(page) };
  const browserService = {
    getBrowser: jest.fn().mockResolvedValue(browser),
    withTimeout: jest.fn((promise: Promise<unknown>) => promise),
  };
  const renderer = new WorkshopEstimatePdfRenderer(browserService as never);
  return { renderer, page, browser, browserService };
}

describe('WorkshopEstimatePdfRenderer', () => {
  it('embeds the bundled fonts, blocks network requests and prints A4 with header and footer', async () => {
    const { renderer, page } = buildRenderer();

    const pdf = await renderer.render({ snapshot: buildEstimateSnapshot() });

    expect(pdf).toEqual(PDF_BYTES);
    expect(page.route).toHaveBeenCalledWith(/^https?:\/\//, expect.any(Function));
    const html = page.setContent.mock.calls[0][0] as string;
    expect(html).toContain('@font-face');
    expect(html).toContain('<h1>Kostenvoranschlag</h1>');
    expect(page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'A4',
        displayHeaderFooter: true,
        printBackground: true,
        footerTemplate: expect.stringContaining('totalPages'),
      }),
    );
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it('embeds the verified logo as a PNG data URL in the page header', async () => {
    const { renderer, page } = buildRenderer();
    const snapshot = buildEstimateSnapshot({
      branding: { ...estimateBrandingFixture, logo: LOGO_FIXTURE },
    });

    await renderer.render({ snapshot, logoPng: LOGO_BYTES });

    const options = page.pdf.mock.calls[0][0] as { headerTemplate: string };
    expect(options.headerTemplate).toContain(
      `src="data:image/png;base64,${LOGO_BYTES.toString('base64')}"`,
    );
  });

  it('refuses to render a pinned logo without its verified bytes and never opens a page', async () => {
    const { renderer, browserService } = buildRenderer();
    const snapshot = buildEstimateSnapshot({
      branding: { ...estimateBrandingFixture, logo: LOGO_FIXTURE },
    });

    await expect(renderer.render({ snapshot })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(browserService.getBrowser).not.toHaveBeenCalled();
  });
});
