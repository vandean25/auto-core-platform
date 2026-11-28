import { readFileSync } from 'node:fs';
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

  test.describe('Infinite CSV export (AUT-1090)', () => {
    async function readDownloadedCsvLines(page: import('@playwright/test').Page, expectedFilename: string) {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: DE_COMMON.dataTable.exportCsv }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(expectedFilename);
      const filePath = await download.path();
      expect(filePath).toBeTruthy();
      const content = readFileSync(filePath!, 'utf8').replace(/^\uFEFF/, '');
      return content.split('\r\n');
    }

    test('WHEN the customer list has loaded 84 matching rows and the user exports CSV THEN kunden.csv has 84 data rows (plus header)', async ({ page }, testInfo) => {
      const rows = Array.from({ length: 84 }, (_, index) =>
        createMockCustomer({
          id: `cust-csv-${index + 1}`,
          first_name: 'Kunde',
          last_name: `Nr${String(index + 1).padStart(3, '0')}`,
          email: `kunde-${index + 1}@example.at`,
        }),
      );
      await mockCursorList(page, { path: '/api/customers', rows });

      await new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer).navigate('/customers');
      await expect(page.getByTestId('data-table-count')).toHaveText('84 Treffer');

      await page.getByRole('button', { name: DE_COMMON.dataTable.infinite.loadMore }).click();
      await expect(page.getByTestId('data-table-announcement')).toHaveText('Ende der Liste, 84 Zeilen geladen.');
      expect(await page.locator('tbody tr[data-table-row]').count()).toBeLessThan(84);

      const lines = await readDownloadedCsvLines(page, 'kunden.csv');
      expect(lines).toHaveLength(85);
      expect(lines[1]).toContain('Kunde Nr001');
      expect(lines[84]).toContain('Kunde Nr084');

      await testInfo.attach('customers-csv-export-84-de-1280', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });

    test('WHEN more than 2,000 matching rows exist THEN CSV export caps at 2,000 rows and shows the cap notice', async ({ page }, testInfo) => {
      const rows = Array.from({ length: 2050 }, (_, index) =>
        createMockCustomer({
          id: `cust-cap-${index + 1}`,
          first_name: 'Kunde',
          last_name: `Cap${String(index + 1).padStart(4, '0')}`,
          email: `cap-${index + 1}@example.at`,
        }),
      );
      await mockCursorList(page, { path: '/api/customers', rows, maxLimit: 250 });

      await new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer).navigate('/customers');
      await expect(page.getByTestId('data-table-count')).toHaveText('1.000+ Treffer');

      const lines = await readDownloadedCsvLines(page, 'kunden.csv');
      expect(lines).toHaveLength(2002);
      expect(lines[2000]).toContain('Kunde Cap2000');
      const capNotice = 'Export auf 2.000 Zeilen begrenzt – Filter eingrenzen';
      expect(lines[2001]).toBe(capNotice);
      const noticeToast = page.locator('[data-sonner-toast]').filter({ hasText: capNotice });
      await expect(noticeToast).toBeVisible();
      await expect(noticeToast).toHaveAttribute('data-mounted', 'true');
      await expect(async () => {
        const opacity = await noticeToast.evaluate((el) => Number(getComputedStyle(el).opacity));
        const box = await noticeToast.boundingBox();
        const viewport = page.viewportSize();
        expect(opacity).toBe(1);
        expect(box).toBeTruthy();
        expect(viewport).toBeTruthy();
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
      }).toPass();

      await testInfo.attach('customers-csv-export-capped-de-1280', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });

    test('at 375px: WHEN a custom field column is visible THEN CSV export includes all 60 rows and the custom field column', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.addInitScript(() => {
        window.localStorage.setItem('e2e-custom-fields-enabled', 'true');
      });
      await page.route(AutoCorePage.apiRouteMatcher('/api/custom-fields/definitions'), async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'def-1',
              entity: 'CUSTOMER',
              key: 'flottennummer',
              label: 'Flottennummer',
              type: 'TEXT',
              options: null,
              purpose: 'Flottenabrechnung',
              personal_data: true,
              retention_class: 'PARENT_OBJECT',
              archived: false,
              sort_order: 0,
              createdAt: '2026-11-24T00:00:00.000Z',
              updatedAt: '2026-11-24T00:00:00.000Z',
            },
          ]),
        });
      });

      const rows = Array.from({ length: 60 }, (_, index) => ({
        ...createMockCustomer({
          id: `cust-cf-${index + 1}`,
          first_name: 'Flotte',
          last_name: `Kunde${String(index + 1).padStart(2, '0')}`,
          email: `flotte-${index + 1}@example.at`,
        }),
        custom_fields: { flottennummer: `FL-${index + 1}` },
      }));
      await mockCursorList(page, { path: '/api/customers', rows });

      await new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer).navigate('/customers');
      await expect(page.getByTestId('data-table-count')).toHaveText('60 Treffer');

      // Show the custom field column (defaultHidden: true) via the column picker.
      await page.getByRole('button', { name: DE_COMMON.dataTable.columns }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Flottennummer' }).click();
      await page.keyboard.press('Escape');

      const exportButton = page.getByRole('button', { name: DE_COMMON.dataTable.exportCsv });
      await expect(exportButton).toBeVisible();
      expect((await exportButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      const lines = await readDownloadedCsvLines(page, 'kunden.csv');
      expect(lines).toHaveLength(61);
      expect(lines[0]).toContain('Flottennummer');
      expect(lines[1]).toContain('FL-1');
      expect(lines[60]).toContain('FL-60');

      await testInfo.attach('customers-csv-export-custom-field-de-375', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  });
});
