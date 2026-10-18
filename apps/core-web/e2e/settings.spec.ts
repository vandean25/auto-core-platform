import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { DE_HR } from './helpers/de-hr';
import { DE_SETTINGS } from './helpers/de-settings';
import {
  createMockFinanceSettings,
  createMockRevenueGroup,
  createMockBrand,
  createMockEmployee,
  createMockBay,
  createMockStorageLocation,
  createMockLaborCategory,
  createMockLaborOperation,
  createMockListResponse,
} from './utils/mock-factories';

/**
 * Blueprint: Settings Page
 *
 * Verifies that the global settings hub appropriately scales across domains
 * without tightly coupling to backend seeded state.
 */
test.describe('Blueprint: Settings Page', () => {
  test('Settings tab navigation and content rendering across tabs', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Settings');

    const waitForApiResponse = (path: string) =>
      page.waitForResponse((response) => {
        return AutoCorePage.apiRouteMatcher(path).test(response.url()) && response.ok();
      });

    const mockFinance = createMockFinanceSettings({ invoice_prefix: 'TEST-', next_invoice_number: 999 });
    const mockRevenueGroup = createMockRevenueGroup({ name: 'Parts Revenue' });
    const mockBrand = createMockBrand({ name: 'Stellantis' });
    const mockEmployee = createMockEmployee({ name: 'Alex Novak', role: 'MECHANIC', sortOrder: 10 });
    const mockBay = createMockBay({ name: 'Bay 01', sortOrder: 1 });
    const mockLocation = createMockStorageLocation({ name: 'Aisle F' });
    const mockLaborCategory = createMockLaborCategory({ name: 'Diagnostic Labor' });
    const mockLaborOperation = createMockLaborOperation({ description: 'Engine Diagnostics' });

    // 1. Mock Endpoints BEFORE Navigation
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockFinance),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockRevenueGroup]),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
      // List response structure is { data, meta } for brands endpoint
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockBrand])),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations/tree'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockLocation]),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/employees'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockEmployee])),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/bays'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockBay])),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/labor/categories'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockLaborCategory])),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/labor/operations'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockLaborOperation])),
      });
    });

    // 2. Navigate 
    await corePage.navigate('/settings');

    // 3. Verify Page load & Default Finance tab
    await expect(page.getByRole('heading', { name: DE_SETTINGS.page.title })).toBeVisible();
    await expect(page.getByLabel(DE_SETTINGS.finance.invoicing.prefix)).toHaveValue('TEST-');
    await expect(page.getByLabel(DE_SETTINGS.finance.invoicing.nextNumber)).toHaveValue('999');

    // 4. Tab Navigation to Revenue Groups
    await page.getByRole('tab', { name: DE_SETTINGS.tabs.revenueGroups }).click();
    await expect(page.getByRole('cell', { name: 'Parts Revenue' })).toBeVisible();

    // Verify Revenue Group Create dialog opens
    await page.getByRole('button', { name: DE_SETTINGS.revenueGroups.addDialog.trigger, exact: true }).click();
    await expect(page.getByRole('dialog', { name: DE_SETTINGS.revenueGroups.addDialog.title })).toBeVisible();
    await page.keyboard.press('Escape');

    // 5. Tab Navigation to Brands
    await page.getByRole('tab', { name: DE_SETTINGS.tabs.brands }).click();
    // exact: the row actions are named "Edit brand Stellantis" / "Delete brand Stellantis" (AUT-471),
    // so a substring match would also resolve to the actions cell.
    await expect(page.getByRole('cell', { name: 'Stellantis', exact: true })).toBeVisible();

    // Verify Brand Create dialog opens
    await page.getByRole('button', { name: DE_SETTINGS.brands.addDialog.trigger, exact: true }).click();
    await expect(page.getByRole('dialog', { name: DE_SETTINGS.brands.addDialog.addTitle })).toBeVisible();
    await page.keyboard.press('Escape');

    // 6. Tab Navigation to Storage Locations
    await page.getByRole('tab', { name: DE_SETTINGS.tabs.locations }).click();
    await expect(page.locator('text="Aisle F"').first()).toBeVisible();

    // (Storage locations creation is inline in SettingsPage, so no dialog test needed, just the button visibility)
    await expect(page.getByRole('button', { name: DE_SETTINGS.storageLocations.form.submit })).toBeVisible();

    // 7. Tab Navigation to Employees
    const employeesResponsePromise = waitForApiResponse('/api/employees');
    await page.getByRole('tab', { name: DE_SETTINGS.tabs.employees }).click();
    await expect(page).toHaveURL(/\/settings\?tab=employees$/);
    await employeesResponsePromise;
    await expect(page.getByRole('cell', { name: 'Alex Novak' })).toBeVisible();
    await expect(page.getByRole('button', { name: DE_SETTINGS.employees.createButton })).toBeVisible();

    await page.getByRole('button', { name: DE_SETTINGS.employees.createButton }).click();
    await expect(page.getByRole('dialog', { name: DE_HR.employees.createDialog.title })).toBeVisible();
    await page.keyboard.press('Escape');

    // 8. Tab Navigation to Bays
    const baysResponsePromise = waitForApiResponse('/api/bays');
    await page.getByRole('tab', { name: DE_SETTINGS.tabs.bays }).click();
    await expect(page).toHaveURL(/\/settings\?tab=bays$/);
    await baysResponsePromise;
    await expect(page.getByRole('cell', { name: 'Bay 01' })).toBeVisible();
    await expect(page.getByRole('button', { name: DE_SETTINGS.bays.createButton })).toBeVisible();

    await page.getByRole('button', { name: DE_SETTINGS.bays.createButton }).click();
    await expect(page.getByRole('dialog', { name: DE_SETTINGS.bays.dialog.title })).toBeVisible();
    await page.keyboard.press('Escape');

    // 9. Tab Navigation to Labor
    const laborCategoriesResponsePromise = waitForApiResponse('/api/labor/categories');
    await page.getByRole('tab', { name: DE_SETTINGS.tabs.labor, exact: true }).click();
    await laborCategoriesResponsePromise;
    await expect(page.getByText('Diagnostic Labor').first()).toBeVisible();

    // Verify Labor category add form is visible
    await expect(page.getByRole('button', { name: DE_SETTINGS.labor.categories.addDialog.submit })).toBeVisible();
  });
});
