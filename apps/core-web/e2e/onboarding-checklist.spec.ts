import { expect, test, type Page } from '@playwright/test';
import { expectNoCriticalA11yViolations } from './utils/a11y';

/**
 * AUT-486: static onboarding checklist for OWNER/ADMIN on the dashboard, and the Help / Docs
 * sidebar link. The E2E session is ADMIN unless `e2e-active-role` overrides it in localStorage.
 */

const CHECKLIST_HEADING = 'Get your workshop set up';
const DISMISS_BUTTON = 'Dismiss onboarding checklist';
const DOCUMENTATION_URL = 'https://autocore-platform.mintlify.site/';

async function setE2eRole(page: Page, role: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('e2e-active-role', value);
  }, role);
}

test.describe('AUT-486: onboarding checklist and Help / Docs', () => {
  test('admins see a checklist that links to each setup page', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: CHECKLIST_HEADING })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open customers' })).toHaveAttribute('href', '/customers');
    await expect(page.getByRole('link', { name: 'Open vehicles' })).toHaveAttribute('href', '/vehicles');
    await expect(page.getByRole('link', { name: 'Open inventory' })).toHaveAttribute('href', '/inventory');
    await expect(page.getByRole('link', { name: 'Open workshop orders' })).toHaveAttribute('href', '/workshop/orders');
  });

  test('a checklist step opens its page', async ({ page }) => {
    await page.goto('/dashboard');

    await page.getByRole('link', { name: 'Open vehicles' }).click();

    await expect(page).toHaveURL(/\/vehicles$/);
  });

  test('stays dismissed after reload', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: DISMISS_BUTTON }).click();
    await expect(page.getByRole('heading', { name: CHECKLIST_HEADING })).toHaveCount(0);

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: CHECKLIST_HEADING })).toHaveCount(0);
  });

  test('hides the checklist from non-admin roles', async ({ page }) => {
    await setE2eRole(page, 'SALES');

    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: CHECKLIST_HEADING })).toHaveCount(0);
  });

  test('sidebar Help / Docs opens the documentation in a new tab', async ({ page }) => {
    await page.goto('/dashboard');

    const helpLink = page.getByRole('link', { name: 'Help / Docs' });
    await expect(helpLink).toHaveAttribute('href', DOCUMENTATION_URL);
    await expect(helpLink).toHaveAttribute('target', '_blank');
    await expect(helpLink).toHaveAttribute('rel', /noopener/);
    await expect(helpLink).toHaveAttribute('rel', /noreferrer/);
  });

  test('dashboard with the checklist has no critical accessibility violations', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: CHECKLIST_HEADING })).toBeVisible();

    await expectNoCriticalA11yViolations(page);
  });
});
