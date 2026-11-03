import { expect, type Locator, type Page } from '@playwright/test';

/** AUT-657: shared setup for the advisory screenshot suite in `e2e/visual/`. */

/** Every page is rendered at this instant, so relative dates ("vor 2 Tagen") and "today" markers never move. */
const FIXED_TIME = new Date('2026-06-15T09:00:00+02:00');

/** The e2e auth bypass has one fixed account; it is masked anyway so a different account never breaks a baseline. */
const MASKED_SELECTORS = ['time', '[data-slot="avatar"]', '[data-visual-mask]', '[role="status"][aria-live="polite"]'];

/** Only real API calls: the dev server also serves modules under `/src/api/`. */
const API_CALL = /^https?:\/\/[^/]+\/api\//;

/** Freezes the clock and answers every API call that a spec did not mock with a 404 (instead of the SPA's index.html), so no widget sees a wrong-shaped body. */
export async function prepareVisualPage(page: Page) {
  await page.clock.setFixedTime(FIXED_TIME);
  // Playwright tries the newest route first, so specs that register their mocks later still win.
  await page.route(API_CALL, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not mocked"}' }),
  );
  await page.route(/\/api\/me\/sites$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

/** Tall pages are captured whole, but never beyond this height. */
const MAX_PAGE_HEIGHT = 3000;

/**
 * Waits for web fonts, spinners and pending requests, then compares the page with its baseline.
 * With `wholePage` the viewport grows to the page height (a `fullPage` shot would stitch the fixed
 * sidebar and the sticky bars into the middle of the image).
 */
export async function expectVisualMatch(page: Page, name: string, options: { wholePage?: boolean; mask?: Locator[] } = {}) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.animate-spin')).toHaveCount(0);
  const viewport = page.viewportSize();
  if ((options.wholePage ?? true) && viewport) {
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(pageHeight, viewport.height), MAX_PAGE_HEIGHT) });
  }
  await expect(page).toHaveScreenshot(`${name}.png`, {
    mask: [...MASKED_SELECTORS.map((selector) => page.locator(selector)), ...(options.mask ?? [])],
  });
}
