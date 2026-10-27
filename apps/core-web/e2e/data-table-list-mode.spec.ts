import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockCustomer,
  createMockListResponse,
  createMockVehicleListItem,
  createMockWorkshopOrder,
} from './utils/mock-factories';
import deCommon from '../../../locales/de/common.json' with { type: 'json' };
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' };

/**
 * AUT-737: below md the DataTable renders two-line list rows with a "..." row actions menu
 * instead of a horizontally scrolling table.
 */
const PHONE = { width: 375, height: 812 };
const ROW_ACTIONS = deCommon.dataTable.rowActions;

async function mockList(page: Page, path: string, items: unknown[]) {
  await page.route(AutoCorePage.apiRouteMatcher(path), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse(items)),
    });
  });
}

async function expectListModeWithoutPageScroll(page: Page) {
  await expect(page.locator('[data-table-list="true"]')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('DataTable list mode on a phone (AUT-737)', () => {
  test.use({ viewport: PHONE });

  test('workshop orders: list rows, 44px "..." menu with registry actions, no page scroll', async ({ page }, testInfo) => {
    await mockList(page, '/api/workshop/orders', [
      createMockWorkshopOrder({ id: 'ws-1', order_number: 'WO-2026-0001' }),
      createMockWorkshopOrder({ id: 'ws-2', order_number: 'WO-2026-0002', status: 'IN_PROGRESS' }),
    ]);
    await new AutoCorePage(page, deWorkshop.orders.list.newOrder).navigate('/workshop/orders');

    await expectListModeWithoutPageScroll(page);
    const row = page.locator('[data-table-row="true"]').first();
    await expect(row).toContainText('WO-2026-0001');
    await expect(row).toContainText('2020 Skoda Octavia');

    const trigger = row.getByRole('button', { name: ROW_ACTIONS });
    const box = await trigger.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);

    await trigger.click();
    await expect(page.getByRole('menuitem', { name: deWorkshop.orders.list.actions.open })).toBeVisible();
    await testInfo.attach('workshop-orders-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('customers: tapping a row opens the peek sheet', async ({ page }, testInfo) => {
    await mockList(page, '/api/customers', [
      createMockCustomer({ id: 'cust-1', first_name: 'Pilot', last_name: 'Customer' }),
    ]);
    await new AutoCorePage(page, '').navigate('/customers');

    await expectListModeWithoutPageScroll(page);
    await page.locator('[data-table-row="true"]').first().getByText('Pilot Customer').click();
    await expect(page).toHaveURL(/[?&]peek=cust-1/);
    await testInfo.attach('customers-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('vehicles: list rows without page scroll', async ({ page }, testInfo) => {
    await mockList(page, '/api/vehicles', [
      createMockVehicleListItem({ make: 'Skoda', model: 'Octavia', plate: 'SK-2020-OCT' }),
    ]);
    await new AutoCorePage(page, '').navigate('/vehicles');

    await expectListModeWithoutPageScroll(page);
    await expect(page.locator('[data-table-row="true"]').first()).toContainText('SK-2020-OCT');
    await testInfo.attach('vehicles-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

test.describe('DataTable at desktop width (AUT-737)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('keeps the table', async ({ page }, testInfo) => {
    await mockList(page, '/api/customers', [createMockCustomer({ id: 'cust-1' })]);
    await new AutoCorePage(page, '').navigate('/customers');

    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('[data-table-list="true"]')).toHaveCount(0);
    await testInfo.attach('customers-desktop', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
