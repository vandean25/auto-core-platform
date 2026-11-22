import { performance } from 'node:perf_hooks';
import { PlaywrightBrowserService } from '../src/common/services/playwright-browser.service.js';

/**
 * AUT-1026 Scenario 4: records real Chromium cold-launch vs. warm-reuse timings
 * on PlaywrightBrowserService.
 *
 * Startup warm-up in onModuleInit() is deferred because `deploy-pdf-worker` in
 * `cloudbuild.yaml` runs on Cloud Run with `--min-instances 0`, `--concurrency 1`,
 * `--cpu 1`, and request-based billing (no `--no-cpu-throttling`), and
 * production minScale changes are out of scope for AUT-1026. On scale-to-zero
 * containers, the instance boots only when the triggering Cloud Task arrives,
 * so launching Chromium during Nest boot does not remove the cold-start cost
 * from the first request's wall-clock time (and blocking onModuleInit() would
 * delay non-PDF startup). PlaywrightBrowserService already caches and reuses
 * the single Browser instance for subsequent renders on a warm container.
 */
describe('PlaywrightBrowserService cold-start and warm-reuse (e2e)', () => {
  let browserService: PlaywrightBrowserService;

  beforeAll(() => {
    browserService = new PlaywrightBrowserService();
  });

  afterAll(async () => {
    await browserService.onModuleDestroy();
  });

  it('measures cold Chromium launch and reuses the warm browser instance', async () => {
    const coldStart = performance.now();
    const coldBrowser = await browserService.getBrowser();
    const coldLaunchMs = Math.round(performance.now() - coldStart);

    const firstRenderStart = performance.now();
    const firstPage = await coldBrowser.newPage();
    let firstPdfBytes: number;
    try {
      await firstPage.setContent('<html><body><h1>AUT-1026 cold</h1></body></html>');
      const pdf = await firstPage.pdf({ format: 'A4' });
      firstPdfBytes = pdf.byteLength;
    } finally {
      await firstPage.close();
    }
    const firstRenderMs = Math.round(performance.now() - firstRenderStart);

    const warmStart = performance.now();
    const warmBrowser = await browserService.getBrowser();
    const warmReuseMs = Math.round(performance.now() - warmStart);

    const secondRenderStart = performance.now();
    const secondPage = await warmBrowser.newPage();
    let secondPdfBytes: number;
    try {
      await secondPage.setContent('<html><body><h1>AUT-1026 warm</h1></body></html>');
      const pdf = await secondPage.pdf({ format: 'A4' });
      secondPdfBytes = pdf.byteLength;
    } finally {
      await secondPage.close();
    }
    const secondRenderMs = Math.round(performance.now() - secondRenderStart);

    console.info(
      `AUT-1026 PlaywrightBrowserService timings: ${JSON.stringify({
        coldLaunchMs,
        firstRenderMs,
        warmReuseMs,
        secondRenderMs,
        firstPdfBytes,
        secondPdfBytes,
      })}`,
    );

    expect(coldBrowser.isConnected()).toBe(true);
    expect(warmBrowser).toBe(coldBrowser);
    expect(warmBrowser.isConnected()).toBe(true);
    expect(coldLaunchMs).toBeGreaterThan(warmReuseMs);
    expect(firstPdfBytes).toBeGreaterThan(0);
    expect(secondPdfBytes).toBeGreaterThan(0);
  });
});
