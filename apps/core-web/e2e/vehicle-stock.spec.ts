import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockListResponse, createMockVehicleStockRow } from './utils/mock-factories';

/**
 * Blueprint Validation Suite — Vehicle Stock Module
 */
test.describe('Blueprint: Vehicle Stock Module', () => {
  test('list page renders and follows golden rules', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Vehicle');
    const stockRow = createMockVehicleStockRow();

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-stock'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([stockRow])),
      });
    });

    await corePage.navigate('/vehicle-stock');

    await corePage.verifyHeaderConsistency('Vehicle Stock');
    await expect(corePage.dataTable).toBeVisible();
    await corePage.openRowDetails('Volkswagen Golf');
    await expect(page).toHaveURL(new RegExp(`/vehicle-stock/${stockRow.id}`));
  });

  test('draft purchase rows open the purchase page and expose Delete', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Vehicle');
    const draftRow = createMockVehicleStockRow({
      id: 'draft-purchase-123',
      make: 'Audi',
      model: 'A4',
      vin: 'WAUZZZ8K8DA000002',
      plate: null,
      stock_status: 'ON_ORDER',
      draft_purchase_id: 'draft-purchase-123',
    });
    const stockRow = createMockVehicleStockRow();

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-stock'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([draftRow, stockRow])),
      });
    });

    await corePage.navigate('/vehicle-stock');

    const draftTableRow = page.locator('[data-table-row="true"]').filter({ hasText: 'Audi A4' }).first();
    await draftTableRow.click({ button: 'right' });
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await page.keyboard.press('Escape');

    const stockTableRow = page.locator('[data-table-row="true"]').filter({ hasText: 'Volkswagen Golf' }).first();
    await stockTableRow.click({ button: 'right' });
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await corePage.openRowDetails('Audi A4');
    await expect(page).toHaveURL(/\/vehicle-stock\/purchases\/draft-purchase-123/);
  });
});
