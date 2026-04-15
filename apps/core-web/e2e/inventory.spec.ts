import { test, expect } from '@playwright/test';

test.describe('Inventory Management', () => {
  test('should display inventory list and open item details sheet', async ({ page }) => {
    await page.goto('/inventory');

    // Check if the inventory heading is visible
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    // Check if the table has data (using a known SKU from seed data)
    await expect(page.getByRole('cell', { name: '06J-115-403-Q' }).first()).toBeVisible();

    // Click on a row to open details
    await page.getByRole('row').filter({ hasText: '06J-115-403-Q' }).first().click();

    // Scope assertions to the opened details dialog to avoid strict-mode text ambiguity.
    const detailsDialog = page.getByRole('dialog', { name: 'Item Details' });
    await expect(detailsDialog).toBeVisible();
    await expect(detailsDialog.getByText('06J-115-403-Q', { exact: true })).toBeVisible();
  });

  test('should allow searching for parts', async ({ page }) => {
    await page.goto('/inventory');

    // Find the search input and type a part number
    const searchInput = page.getByPlaceholder('Search parts...');
    await searchInput.fill('06J-115-403-Q');

    // Check if the filtered results are visible
    await expect(page.getByRole('cell', { name: '06J-115-403-Q' }).first()).toBeVisible();
  });

  test('should prevent crashing on malformed API data (Boundary Safety)', async ({ page }) => {
    // Intercept the brands API and return malformed data
    // This tests the hardened useBrands hook implementation
    await page.route(/\/api\/brands(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: 'this-should-be-an-array-but-is-a-string' }), 
      });
    });

    // Navigate after route setup to ensure malformed data is used on initial load.
    await page.goto('/inventory');

    // The page should NOT crash or go blank.
    await expect(page.getByPlaceholder('Search parts...')).toBeVisible({ timeout: 20000 });
    
    // The table should still load items (uses a different API)
    await expect(page.getByRole('row').filter({ hasText: '06J-115-403-Q' }).first()).toBeVisible({ timeout: 10000 });
  });
});
