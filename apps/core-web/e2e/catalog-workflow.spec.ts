import { test, expect } from '@playwright/test';
import { WorkshopPOM } from './pom/WorkshopPOM';
import { createMockWorkshopOrder } from './utils/mock-factories';

test.describe('Catalog Fitment Filtering Workflow', () => {
  const WORKSHOP_ORDER_ID = 'WS-BLUEPRINT-001';
  const SEARCH_QUERY = 'SearchKey';

  test('should display only universal and vehicle-matching labor operations', async ({ page }) => {
    const workshop = new WorkshopPOM(page);

    await test.step('Setup: Mock data aligned with OpenAPI structures', async () => {
      // Use factory to ensure schema alignment
      await workshop.mockOrderDetails(WORKSHOP_ORDER_ID, {
        make: 'Skoda',
        model: 'Octavia',
      });

      // Mock Catalog Search
      await page.route(/\/api\/catalog\/search\?.*q=SearchKey.*/, async (route) => {
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

    await test.step('Action: Navigate and open Task with fitment context', async () => {
      await workshop.gotoOrder(WORKSHOP_ORDER_ID);
      
      // Rule: Verify branding visibility establishes context
      await expect(page.getByText('Skoda Octavia')).toBeVisible();

      // Rule: Click row to open details
      await workshop.openTask('General Inspection');
    });

    await test.step('Action: Perform Catalog Search', async () => {
      await workshop.searchCatalog(SEARCH_QUERY);
    });

    await test.step('Verify: Result Consistency and Fitment Exclusion', async () => {
      const drawer = page.getByRole('dialog');
      
      // Rule: Verify visibility of expected roles/items
      await expect(drawer.getByText('UNIVERSAL-LABOR')).toBeVisible();
      await expect(drawer.getByText('SKODA-LABOR')).toBeVisible();

      // Rule: BMW items should be hidden by the filtering logic (verified by backend integration tests)
      // but here we verify that the UI doesn't accidentally show items the API omitted.
      await expect(drawer.getByText('BMW-LABOR')).not.toBeVisible();
    });
  });
});
