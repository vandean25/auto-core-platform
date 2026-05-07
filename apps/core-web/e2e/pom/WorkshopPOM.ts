import { Page, expect } from '@playwright/test';
import { AutoCorePage } from './AutoCorePage';

/**
 * WorkshopPOM extends AutoCorePage with Workshop-domain interactions.
 *
 * Covers:
 * - Navigating to a specific workshop order detail page.
 * - Opening a task row (uses `data-workshop-task-row="true"` attribute).
 * - Searching the parts / labor catalog within a task drawer.
 * - Mocking a workshop order with an OpenAPI-aligned payload.
 */
export class WorkshopPOM extends AutoCorePage {
  constructor(page: Page) {
    super(page, 'Order');
  }

  async gotoOrder(id: string) {
    await this.navigate(`/workshop/orders/${id}`);
  }

  async openTask(title: string) {
    const taskRow = this.page
      .locator('[data-workshop-task-row="true"]')
      .filter({ hasText: title })
      .first();
    await expect(taskRow).toBeVisible();
    await taskRow.click();

    // The task detail drawer renders as role="dialog" or role="complementary"
    const detailView = this.page
      .locator('[role="dialog"], [role="complementary"]')
      .first();
    await expect(detailView).toBeVisible();
  }

  async searchCatalog(query: string) {
    const searchInput = this.page.getByPlaceholder('Search labor or part number...');
    await searchInput.fill(query);

    // Rule: suggestions list must appear after typing
    await expect(this.page.getByRole('listbox', { name: 'Suggestions' })).toBeVisible();
  }

  /**
   * Mocks the workshop order detail endpoint with a minimal OpenAPI-aligned payload.
   * Must be called BEFORE navigating so the interceptor is registered first.
   */
  async mockOrderDetails(id: string, vehicle: { make: string; model: string }) {
    await this.page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${id}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id,
            order_number: `WS-TEST-${id}`,
            status: 'OPEN',
            reported_issue: 'Test maintenance',
            customer: {
              id: 'CUST-1',
              type: 'PRIVATE',
              first_name: 'Test',
              last_name: 'User',
              company_name: null,
            },
            vehicle: { id: 'VEH-1', ...vehicle, year: 2020, plate: 'TEST-1' },
            tasks: [
              {
                id: 'TASK-1',
                title: 'General Inspection',
                status: 'NOT_STARTED',
                done: false,
                lineItems: [],
                mechanicNotes: '',
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        });
      },
    );
  }
}
