import { expect, test } from '@playwright/test';
import { DE_COMMON } from './helpers/de-common';
import { DE_SHELL } from './helpers/de-shell';
import { DE_CUSTOMERS } from './helpers/de-customers';
import { AutoCorePage } from './pom/AutoCorePage';
import { expectNoCriticalA11yViolations } from './utils/a11y';
import { createMockCustomer, createMockListResponse } from './utils/mock-factories';

/**
 * AUT-488: The list-view buttons carry clear labels and a one-line tooltip that opens on
 * focus and hover and closes with Escape. The empty sidebar Favorites copy names the new label.
 */
const SAVE_NAME = DE_COMMON.savedViews.saveAria.replace('{{title}}', DE_CUSTOMERS.list.saveViewTitle);
const ADD_NAME = DE_COMMON.dashboard.addToDashboard;
const SAVE_TOOLTIP = DE_COMMON.savedViews.saveHint;
const ADD_TOOLTIP = DE_COMMON.dashboard.addToDashboardHint;

test.describe('List view actions: labels and tooltips (AUT-488)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            createMockCustomer({
              id: 'cust-klaus',
              first_name: 'Klaus',
              last_name: 'Kombi',
              email: 'klaus@logistik.at',
            }),
          ]),
        ),
      });
    });
  });

  test('empty sidebar Favorites copy names the new Save button', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');

    await expect(
      page.getByText(DE_SHELL.favorites.empty),
    ).toBeVisible();
  });

  test('save button shows its tooltip on keyboard focus and hides it on Escape', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers?search=klaus');

    await page.getByRole('button', { name: SAVE_NAME }).focus();
    await expect(page.getByRole('tooltip')).toHaveText(SAVE_TOOLTIP);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('add button shows its tooltip on hover and hides it on Escape', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers?search=klaus');

    await page.getByRole('button', { name: ADD_NAME, exact: true }).hover();
    await expect(page.getByRole('tooltip')).toHaveText(ADD_TOOLTIP);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('list toolbar passes the critical accessibility scan with a tooltip open', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers?search=klaus');

    await page.getByRole('button', { name: ADD_NAME, exact: true }).focus();
    await expect(page.getByRole('tooltip')).toHaveText(ADD_TOOLTIP);

    await expectNoCriticalA11yViolations(page);
  });
});
