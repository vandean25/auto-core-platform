import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockCustomer, createMockListResponse } from './utils/mock-factories';

/**
 * AUT-220: Clicking a customer row must open that customer's detail page.
 */
test.describe('Customers list row navigation (AUT-220)', () => {
  const customers = [
    createMockCustomer({
      id: 'cust-klaus',
      first_name: 'Klaus',
      last_name: 'Kombi',
      email: 'klaus@logistik.at',
    }),
    createMockCustomer({
      id: 'cust-susi',
      first_name: 'Susi',
      last_name: 'Sorglos',
      email: 'susi@sorglos.at',
    }),
    createMockCustomer({
      id: 'cust-max',
      first_name: 'Max',
      last_name: 'Mustermann3',
      email: 'max@example.at',
    }),
    createMockCustomer({
      id: 'cust-thomas',
      first_name: 'Thomas',
      last_name: 'Turboschrauber',
      email: 'thomas@tuning.at',
    }),
    createMockCustomer({
      id: 'cust-anna',
      first_name: 'Anna',
      last_name: 'Alpin',
      email: 'anna@berge.at',
    }),
  ];

  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse(customers)),
      });
    });
  });

  async function clickRowAndExpectCustomerId(page: import('@playwright/test').Page, label: string, expectedId: string) {
    const row = page.locator('[data-table-row="true"]').filter({ hasText: label }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/customers/${expectedId}$`));
    await page.goBack();
    await page.waitForLoadState('networkidle');
  }

  test('each row opens the matching customer detail URL', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Customer');
    await corePage.navigate('/customers');

    await clickRowAndExpectCustomerId(page, 'Max Mustermann3', 'cust-max');
    await clickRowAndExpectCustomerId(page, 'Anna Alpin', 'cust-anna');
    await clickRowAndExpectCustomerId(page, 'Klaus Kombi', 'cust-klaus');
    await clickRowAndExpectCustomerId(page, 'Susi Sorglos', 'cust-susi');
    await clickRowAndExpectCustomerId(page, 'Thomas Turboschrauber', 'cust-thomas');
  });

  test('row clicks stay correct after scrolling a short viewport (AUT-220)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    const corePage = new AutoCorePage(page, 'Customer');
    await corePage.navigate('/customers');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await clickRowAndExpectCustomerId(page, 'Max Mustermann3', 'cust-max');
  });

  test('mouse click at row center opens the matching customer (AUT-220)', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Customer');
    await corePage.navigate('/customers');

    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'Anna Alpin' }).first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page).toHaveURL(/\/customers\/cust-anna$/);
  });
});
