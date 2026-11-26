import { expectNoCriticalA11yViolations } from "./utils/a11y";
import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockCustomer, createMockListResponse } from './utils/mock-factories';
import { mockCursorList, requestedBlocks } from './utils/cursor-list-mock';
import { DE_COMMON } from './helpers/de-common';
import { DE_CUSTOMERS } from './helpers/de-customers';
import { expectNoPageScroll, pageOverflow, PHONE_WIDTHS } from './utils/phone-layout';
import {
  closeListPeekSheet,
  expectListPeekForRecord,
  openListPeekInFull,
} from './helpers/peek-list';

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
      phone: '+43 660 1234567',
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
    sheetHeading: string,
  ) {
    const row = page.locator('[data-table-row="true"]').filter({ hasText: label }).first();
    await expect(row).toBeVisible();
    await row.getByText(label).click();
    await expectListPeekForRecord(page, expectedId, sheetHeading);
    await closeListPeekSheet(page);
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

    const annaRow = page.locator('[data-table-row="true"]').filter({ hasText: 'Anna Alpin' }).first();
    await annaRow.getByText('Anna Alpin').click();
    await expectListPeekForRecord(page, 'cust-anna', 'Anna Alpin');
    await openListPeekInFull(page);
    await expect(page).toHaveURL(/\/customers\/cust-anna$/);
  });

  test('row clicks stay correct after scrolling a short viewport (AUT-220)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'Max Mustermann3' }).first();
    await row.getByText('Max Mustermann3').click();
    await expectListPeekForRecord(page, 'cust-max', 'Max Mustermann3');
    await openListPeekInFull(page);
    await expect(page).toHaveURL(/\/customers\/cust-max$/);
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

  // AUT-883 validation: the create entry of the customer list was 36px high on a phone (the vehicle list's is 44px).
  for (const width of PHONE_WIDTHS) {
    test(`${width}px: the create button is a 44px touch target inside the screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
      await corePage.navigate('/customers');

      const box = (await corePage.createButton.first().boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  }

  test('WHEN the customer list at 375px has a row with a phone number THEN a 44px tel target is present', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 844 });
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');

    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'Anna Alpin' });
    const tel = row.locator('a[href^="tel:"]');
    await expect(tel).toBeVisible();
    await expect(tel).toHaveAttribute('href', 'tel:+436601234567');
    const box = (await tel.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await expectNoPageScroll(page);
    await testInfo.attach('aut-953-customers-375', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    // Scenario 6 (AUT-957): default sort scrolls in blocks of 50 without page buttons; regression = page buttons or
    // second block never loads on a phone.
    test('infinite next block', async ({ page }, testInfo) => {
      const rows = Array.from({ length: 60 }, (_, index) =>
        createMockCustomer({
          id: `customer-infinite-${index}`,
          first_name: `Kunde`,
          last_name: `Block${String(1000 + index)}`,
          email: `kunde-${index}@example.at`,
        }),
      );
      const requests = await mockCursorList(page, { path: '/api/customers', rows });

      await new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer).navigate('/customers');
      await expect(page.locator('li[data-table-row="true"]').first()).toBeVisible();
      await expect(page.getByTestId('data-table-count')).toHaveText('60 Treffer');
      expect(Object.fromEntries(requests.list[0].searchParams)).toEqual({ pagination: 'cursor', limit: '50' });
      await expect(page.getByRole('combobox', { name: DE_COMMON.dataTable.rowsPerPageAria })).toHaveCount(0);

      const loadMore = page.getByRole('button', { name: DE_COMMON.dataTable.infinite.loadMore });
      await expect(loadMore).toBeVisible();
      expect((await loadMore.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await pageOverflow(page)).toBe(0);

      await expect(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(requestedBlocks(requests).has('offset:50')).toBe(true);
      }).toPass();
      await expect(page.getByText('Kunde Block1059')).toBeAttached();
      await testInfo.attach('customers-infinite-next-block-375', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  });
});
