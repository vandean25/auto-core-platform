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

    // 2. Navigate to settings overview
    await corePage.navigate('/settings');
    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.page.title })).toBeVisible();

    // 3. Navigate to Finance subpage via tile
    await page.locator('main a[href="/settings/finance"]').click();
    await expect(page).toHaveURL(/\/settings\/finance$/);
    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.tabs.finance })).toBeVisible();
    await expect(page.getByLabel(DE_SETTINGS.finance.invoicing.prefix)).toHaveValue('TEST-');
    await expect(page.getByLabel(DE_SETTINGS.finance.invoicing.nextNumber)).toHaveValue('999');

    // 4. Navigate to Revenue Groups via overview
    await page.getByRole('link', { name: DE_SETTINGS.page.backToOverview }).click();
    await page.locator('main a[href="/settings/revenue-groups"]').click();
    await expect(page).toHaveURL(/\/settings\/revenue-groups$/);
    await expect(page.getByRole('cell', { name: 'Parts Revenue' })).toBeVisible();

    // Verify Revenue Group Create dialog opens
    await page.getByRole('button', { name: DE_SETTINGS.revenueGroups.addDialog.trigger, exact: true }).click();
    await expect(page.getByRole('dialog', { name: DE_SETTINGS.revenueGroups.addDialog.title })).toBeVisible();
    await page.keyboard.press('Escape');

    // 5. Navigate to Brands via overview
    await page.getByRole('link', { name: DE_SETTINGS.page.backToOverview }).click();
    await page.locator('main a[href="/settings/brands"]').click();
    await expect(page).toHaveURL(/\/settings\/brands$/);
    // exact: the row actions are named "Edit brand Stellantis" / "Delete brand Stellantis" (AUT-471),
    // so a substring match would also resolve to the actions cell.
    await expect(page.getByRole('cell', { name: 'Stellantis', exact: true })).toBeVisible();

    // Verify Brand Create dialog opens
    await page.getByRole('button', { name: DE_SETTINGS.brands.addDialog.trigger, exact: true }).click();
    await expect(page.getByRole('dialog', { name: DE_SETTINGS.brands.addDialog.addTitle })).toBeVisible();
    await page.keyboard.press('Escape');

    // 6. Navigate to Storage Locations via overview
    await page.getByRole('link', { name: DE_SETTINGS.page.backToOverview }).click();
    await page.locator('main a[href="/settings/locations"]').click();
    await expect(page).toHaveURL(/\/settings\/locations$/);
    await expect(page.locator('text="Aisle F"').first()).toBeVisible();

    // (Storage locations creation is inline in SettingsPage, so no dialog test needed, just the button visibility)
    await expect(page.getByRole('button', { name: DE_SETTINGS.storageLocations.form.submit })).toBeVisible();

    // 7. Navigate to Employees via overview
    await page.getByRole('link', { name: DE_SETTINGS.page.backToOverview }).click();
    const employeesResponsePromise = waitForApiResponse('/api/employees');
    await page.locator('main a[href="/settings/employees"]').click();
    await expect(page).toHaveURL(/\/settings\/employees$/);
    await employeesResponsePromise;
    await expect(page.getByRole('cell', { name: 'Alex Novak' })).toBeVisible();
    await expect(page.getByRole('button', { name: DE_SETTINGS.employees.createButton })).toBeVisible();

    await page.getByRole('button', { name: DE_SETTINGS.employees.createButton }).click();
    await expect(page.getByRole('dialog', { name: DE_HR.employees.createDialog.title })).toBeVisible();
    await page.keyboard.press('Escape');

    // 8. Navigate to Bays via overview
    await page.getByRole('link', { name: DE_SETTINGS.page.backToOverview }).click();
    const baysResponsePromise = waitForApiResponse('/api/bays');
    await page.locator('main a[href="/settings/bays"]').click();
    await expect(page).toHaveURL(/\/settings\/bays$/);
    await baysResponsePromise;
    await expect(page.getByRole('cell', { name: 'Bay 01' })).toBeVisible();
    await expect(page.getByRole('button', { name: DE_SETTINGS.bays.createButton })).toBeVisible();

    await page.getByRole('button', { name: DE_SETTINGS.bays.createButton }).click();
    await expect(page.getByRole('dialog', { name: DE_SETTINGS.bays.dialog.title })).toBeVisible();
    await page.keyboard.press('Escape');

    // 9. Navigate to Labor via overview
    await page.getByRole('link', { name: DE_SETTINGS.page.backToOverview }).click();
    const laborCategoriesResponsePromise = waitForApiResponse('/api/labor/categories');
    await page.locator('a[href="/settings/labor"]').click();
    await expect(page).toHaveURL(/\/settings\/labor$/);
    await laborCategoriesResponsePromise;
    await expect(page.getByText('Diagnostic Labor').first()).toBeVisible();

    // Verify Labor category add form is visible
    await expect(page.getByRole('button', { name: DE_SETTINGS.labor.categories.addDialog.submit })).toBeVisible();
  });

  test('Fiscal lock date confirmation dialog opens on first set and saves after confirming', async ({ page }, testInfo) => {
    const corePage = new AutoCorePage(page, 'Settings');
    let currentSettings = createMockFinanceSettings({ lock_date: null });
    const patchPayloads: unknown[] = [];

    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { lock_date?: string | null };
        patchPayloads.push(body);
        currentSettings = {
          ...currentSettings,
          lock_date: body.lock_date ? `${body.lock_date}T00:00:00.000Z` : currentSettings.lock_date,
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentSettings),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentSettings),
      });
    });

    await corePage.navigate('/settings/finance');
    const lockDateInput = page.getByRole('textbox', { name: DE_SETTINGS.finance.fiscal.lockDate });
    await expect(lockDateInput).toBeVisible();

    await lockDateInput.fill('31.10.2026');
    await page.getByRole('button', { name: DE_SETTINGS.finance.saveChanges }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(DE_SETTINGS.finance.lockDialog.title)).toBeVisible();
    expect(patchPayloads).toHaveLength(0);

    await testInfo.attach('fiscal-lock-dialog-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(dialog).toBeVisible();
    await testInfo.attach('fiscal-lock-dialog-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await dialog.getByRole('button', { name: DE_SETTINGS.finance.lockDialog.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(patchPayloads).toEqual([
      expect.objectContaining({
        lock_date: '2026-10-31',
      }),
    ]);
  });
});
