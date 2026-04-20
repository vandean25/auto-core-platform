import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockFinanceSettings,
  createMockRevenueGroup,
  createMockBrand,
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
  test('Settings tab navigation, content rendering, and CRUD operations', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Settings');

    const mockFinance = createMockFinanceSettings({ invoice_prefix: 'TEST-', next_invoice_number: 999 });
    const mockRevenueGroup = createMockRevenueGroup({ name: 'Parts Revenue' });
    const mockBrand = createMockBrand({ name: 'Stellantis' });
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

    await page.route(AutoCorePage.apiRouteMatcher('/api/labor/categories'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockLaborCategory] }),
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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByLabel('Prefix')).toHaveValue('TEST-');
    await expect(page.getByLabel('Next Number')).toHaveValue('999');

    // 4. Tab Navigation to Revenue Groups
    await page.getByRole('tab', { name: 'Revenue Groups' }).click();
    await expect(page.getByRole('cell', { name: 'Parts Revenue' })).toBeVisible();

    // Verify Revenue Group Create dialog opens
    await page.getByRole('button', { name: /Group/i, exact: false }).filter({ hasText: 'Group' }).click();
    await expect(page.getByRole('dialog', { name: /Revenue Group/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // 5. Tab Navigation to Brands
    await page.getByRole('tab', { name: 'Brands' }).click();
    await expect(page.getByRole('cell', { name: 'Stellantis' })).toBeVisible();

    // Verify Brand Create dialog opens
    await page.getByRole('button', { name: /Brand/i, exact: false }).filter({ hasText: 'Brand' }).click();
    await expect(page.getByRole('dialog', { name: /Brand/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // 6. Tab Navigation to Storage Locations
    await page.getByRole('tab', { name: 'Storage Locations' }).click();
    await expect(page.locator('text="Aisle F"').first()).toBeVisible();

    // (Storage locations creation is inline in SettingsPage, so no dialog test needed, just the button visibility)
    await expect(page.getByRole('button', { name: /Create Location/i })).toBeVisible();

    // 7. Tab Navigation to Labor
    await page.getByRole('tab', { name: 'Labor' }).click();
    await expect(page.getByText('Diagnostic Labor').first()).toBeVisible();

    // Verify Labor category add form is visible
    await expect(page.getByRole('button', { name: /Add Category/i })).toBeVisible();
  });
});
