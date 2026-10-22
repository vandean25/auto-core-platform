import { expectNoCriticalA11yViolations } from "./utils/a11y";
import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockCustomer, createMockListResponse } from './utils/mock-factories';
import { DE_CUSTOMERS } from './helpers/de-customers';
import { expectListPeekForRecord, openListPeekInFull } from './helpers/peek-list';

/**
 * AUT-220: Clicking a customer row must open that customer's peek sheet; Open in full reaches detail.
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

    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/customers\/[^/?]+$/), async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const id = route.request().url().match(/\/customers\/([^/?]+)/)?.[1] ?? '';
      const customer = customers.find((entry) => entry.id === id);
      await route.fulfill({
        status: customer ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(customer ?? { message: 'not found' }),
      });
    });
  });

  async function clickRowAndExpectPeek(
    page: import('@playwright/test').Page,
    label: string,
    expectedId: string,
    sheetLabel: string,
  ) {
    const row = page.locator('[data-table-row="true"]').filter({ hasText: label }).first();
    await expect(row).toBeVisible();
    await row.getByText(label).click();
    await expectListPeekForRecord(page, expectedId, sheetLabel);
    await openListPeekInFull(page);
    await expect(page).toHaveURL(new RegExp(`/customers/${expectedId}$`));
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');
  }

  test('each row opens the matching customer peek and Open in full reaches detail', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');
    await expectNoCriticalA11yViolations(page);

    await clickRowAndExpectPeek(page, 'Max Mustermann3', 'cust-max', 'Max Mustermann3');
    await clickRowAndExpectPeek(page, 'Anna Alpin', 'cust-anna', 'Anna Alpin');
    await clickRowAndExpectPeek(page, 'Klaus Kombi', 'cust-klaus', 'Klaus Kombi');
    await clickRowAndExpectPeek(page, 'Susi Sorglos', 'cust-susi', 'Susi Sorglos');
    await clickRowAndExpectPeek(page, 'Thomas Turboschrauber', 'cust-thomas', 'Thomas Turboschrauber');
  });

  test('row clicks stay correct after scrolling a short viewport (AUT-220)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await clickRowAndExpectPeek(page, 'Max Mustermann3', 'cust-max', 'Max Mustermann3');
  });

  test('mouse click at row center opens the matching customer peek (AUT-220)', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');

    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'Anna Alpin' }).first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expectListPeekForRecord(page, 'cust-anna', 'Anna Alpin');
    await openListPeekInFull(page);
    await expect(page).toHaveURL(/\/customers\/cust-anna$/);
  });
});
