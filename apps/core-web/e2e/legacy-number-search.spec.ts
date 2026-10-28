import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockCustomerDetailResponse, createMockVehicle } from './utils/mock-factories';
import { DE_CUSTOMERS } from './helpers/de-customers';
import vehiclesDe from '../../../locales/de/vehicles.json' with { type: 'json' };

const legacyIds = [
  { source_system: 'legacy_system:company_a', external_id: '00123' },
  { source_system: 'legacy_system:company_b', external_id: '00123' },
];
const customer = {
  ...createMockCustomerDetailResponse({ id: 'legacy-customer-1', first_name: 'Mira', last_name: 'Example', email: 'mira@example.test', phone: null }),
  legacy_ids: legacyIds,
};
const vehicle = {
  ...createMockVehicle({ id: 'legacy-vehicle-1', make: 'Example Motors', model: 'Road One', year: 2020, plate: 'SYN-01' }),
  vin: 'ZZZ00000000000001', customer: null, sales: [], purchases: [], invoices: [], sales_orders: [], workshop_orders: [],
  legacy_ids: legacyIds,
};

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\//, async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === '/api/customers' || url.pathname === '/api/vehicles') {
      const search = url.searchParams.get('search');
      const data = !search || search === '00123' ? [url.pathname === '/api/customers' ? customer : vehicle] : [];
      body = { data, meta: { total: data.length, page: 1, pageSize: 25, pageCount: data.length ? 1 : 0 } };
    } else if (url.pathname === `/api/customers/${customer.id}`) {
      body = customer;
    } else if (url.pathname === `/api/vehicles/${vehicle.id}`) {
      body = vehicle;
    } else if (url.pathname === '/api/inspection-source-connections') {
      body = { data: [] };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

for (const width of [1280, 390]) {
  test(`separate single-mapping records retain their source labels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [sourceIndex, { source_system, external_id }] of legacyIds.entries()) {
      for (const { record, path, label } of [
        { record: customer, path: '/customers', label: 'Alte Kundennr. (Vorsystem)' },
        { record: vehicle, path: '/vehicles', label: 'Alte Fahrzeugnr. (Vorsystem)' },
      ]) {
        const id = `${record.id}-${sourceIndex}`;
        await page.route(`**/api${path}/${id}`, (route) => route.fulfill({
          json: { ...record, id, legacy_ids: [{ source_system, external_id }] },
        }));
        await page.goto(`${path}/${id}`);
        await expect(page.getByText(`${label} — ${source_system}`)).toBeVisible();
        await expect(page.getByText(external_id, { exact: true })).toHaveCount(1);
        await expect(page.getByRole('textbox', { name: label })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${id}-${width}.png`), fullPage: true });
      }
    }
  });

  test(`customer legacy search and read-only source labels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');
    const searched = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === '/api/customers' && url.searchParams.get('search') === '00123';
    });
    await page.getByPlaceholder(DE_CUSTOMERS.list.searchPlaceholder).fill('00123');
    await searched;
    await expect(page.locator('[data-table-row="true"]').filter({ hasText: 'Mira Example' })).toBeVisible();
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText('Alte Kundennr. (Vorsystem) — legacy_system:company_a')).toBeVisible();
    await expect(page.getByText('Alte Kundennr. (Vorsystem) — legacy_system:company_b')).toBeVisible();
    await expect(page.getByText('00123', { exact: true })).toHaveCount(2);
    await page.getByText('00123', { exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: /Alte Kundennr/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`customer-legacy-${width}.png`), fullPage: true });
  });

  test(`vehicle legacy search and read-only source labels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const corePage = new AutoCorePage(page, vehiclesDe.list.addVehicle);
    await corePage.navigate('/vehicles');
    const searched = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === '/api/vehicles' && url.searchParams.get('search') === '00123';
    });
    await page.getByPlaceholder(vehiclesDe.list.searchPlaceholder).fill('00123');
    await searched;
    await expect(page.locator('[data-table-row="true"]').filter({ hasText: 'Road One' })).toBeVisible();
    await page.goto(`/vehicles/${vehicle.id}`);
    await expect(page.getByText('Alte Fahrzeugnr. (Vorsystem) — legacy_system:company_a')).toBeVisible();
    await expect(page.getByText('Alte Fahrzeugnr. (Vorsystem) — legacy_system:company_b')).toBeVisible();
    await expect(page.getByText('00123', { exact: true })).toHaveCount(2);
    await page.getByText('00123', { exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: /Alte Fahrzeugnr/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`vehicle-legacy-${width}.png`), fullPage: true });
  });
}
