import type { Page, Route } from 'playwright';

const DATA_URI_PREFIX = 'data:';

/** Allows only embedded `data:` assets (for example PNG logos) while rendering PDF HTML. */
export async function installPdfRendererRequestGuard(page: Page): Promise<void> {
  await page.route('**/*', (route: Route) => {
    const url = route.request().url();
    if (url.startsWith(DATA_URI_PREFIX)) {
      void route.continue();
      return;
    }
    void route.abort();
  });
}
