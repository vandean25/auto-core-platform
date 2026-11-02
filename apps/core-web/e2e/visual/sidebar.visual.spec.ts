import { expect, test } from '@playwright/test';
import { AutoCorePage } from '../pom/AutoCorePage';
import { DE_SHELL } from '../helpers/de-shell';
import { expectVisualMatch, prepareVisualPage } from '../helpers/visual';

/** AUT-657: the grouped sidebar (AUT-656) expanded and collapsed on a desktop, and open as a sheet on a phone. */

const SIDEBAR_STATES = [
  { name: 'sidebar-expanded', viewport: { width: 1440, height: 900 }, collapsed: false, openSheet: false },
  { name: 'sidebar-collapsed', viewport: { width: 1440, height: 900 }, collapsed: true, openSheet: false },
  { name: 'sidebar-mobile-open', viewport: { width: 390, height: 844 }, collapsed: false, openSheet: true },
];

test.describe('sidebar', () => {
  for (const state of SIDEBAR_STATES) {
    test(state.name, async ({ page }) => {
      await page.setViewportSize(state.viewport);
      await page.addInitScript((collapsed) => window.localStorage.setItem('acp:sidebar-collapsed', String(collapsed)), state.collapsed);
      await prepareVisualPage(page);
      await new AutoCorePage(page, state.name).navigate('/dashboard');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      if (state.openSheet) {
        await page.locator('[data-sidebar="trigger"]').click();
      }
      await expect(page.getByRole('navigation', { name: DE_SHELL.mainNavigation })).toBeVisible();
      await expectVisualMatch(page, state.name, { wholePage: false });
    });
  }
});
