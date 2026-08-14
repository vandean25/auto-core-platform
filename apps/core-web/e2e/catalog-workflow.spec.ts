import { test, expect } from '@playwright/test';
import { WorkshopPOM } from './pom/WorkshopPOM';
import { AutoCorePage } from './pom/AutoCorePage';

/**
 * Blueprint: Catalog Fitment Filtering Workflow
 *
 * Validates that the workshop task catalog search shows only items the API returns
 * (universal + vehicle-matching), and does NOT render items that were excluded
 * server-side (e.g. BMW-specific operations when the vehicle is a Skoda).
 *
 * All mocks are registered BEFORE navigation (mock-first-then-navigate pattern).
 */
test.describe('Blueprint: Catalog Fitment Filtering Workflow', () => {
  const WORKSHOP_ORDER_ID = 'WS-BLUEPRINT-001';
  const SEARCH_QUERY = 'SearchKey';

  test('should show only universal and vehicle-matching labor operations', async ({ page }) => {
    const workshop = new WorkshopPOM(page);

    await test.step('Setup: Register all API mocks before navigating', async () => {
      // Mock workshop order detail (includes vehicle context)
      await workshop.mockOrderDetails(WORKSHOP_ORDER_ID, {
        make: 'Skoda',
        model: 'Octavia',
      });

      // Mock catalog search — API has already filtered by vehicle fitment
      await page.route(AutoCorePage.apiRouteMatcher('/api/catalog/search'), async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            labor: [
              {
                id: 101,
                code: 'UNIVERSAL-LABOR',
                description: 'Universal Labor Operation',
                standardAw: 1.0,
                hourlyRate: 100,
              },
              {
                id: 102,
                code: 'SKODA-LABOR',
                description: 'Skoda Specific Labor Operation',
                standardAw: 1.5,
                hourlyRate: 100,
              },
            ],
            parts: [],
            meta: { laborCount: 2, partCount: 0, limit: 20 },
          }),
        });
      });
    });

    await test.step('Action: Navigate to order and open task', async () => {
      // gotoOrder calls navigate which waits for networkidle
      await workshop.gotoOrder(WORKSHOP_ORDER_ID);

      // Vehicle context is visible in the header subtitle and the vehicle card
      await expect(page.getByText('2020 Skoda Octavia', { exact: true })).toBeVisible();

      // Click the task row — validates data-workshop-task-row attribute
      await workshop.openTask('General Inspection');
    });

    await test.step('Action: Type in catalog search box', async () => {
      await workshop.searchCatalog(SEARCH_QUERY);
    });

    await test.step('Verify: API-returned items visible; excluded items absent', async () => {
      await expect(page.getByText('UNIVERSAL-LABOR')).toBeVisible();
      await expect(page.getByText('SKODA-LABOR')).toBeVisible();

      // BMW-LABOR was never returned by the API — it must not appear in the UI
      await expect(page.getByText('BMW-LABOR')).not.toBeVisible();
    });
  });
});
