import { expect, Locator } from '@playwright/test';
import { AutoCorePage } from './AutoCorePage';

export class WorkshopPOM extends AutoCorePage {
  constructor(page: any) {
    super(page, 'Order');
  }

  async gotoOrder(id: string) {
    await this.navigate(`/workshop/orders/${id}`);
  }

  async openTask(title: string) {
    // Ensure the task list is loaded
    const taskRow = this.page.locator('[data-workshop-task-row="true"]').filter({ hasText: title }).first();
    await expect(taskRow).toBeVisible();
    await taskRow.click();

    // Verify detail view opens
    const detailView = this.page.locator('[role="dialog"], [role="complementary"], h2:has-text("Details")').first();
    await expect(detailView).toBeVisible();
  }

  async searchCatalog(query: string) {
    const searchInput = this.page.getByPlaceholder('Search labor or part number...');
    await searchInput.fill(query);
    
    // Rule: Wait for suggestions to appear
    await expect(this.page.locator('[role="listbox"], [data-radix-collection-item]')).toBeVisible();
  }

  /**
   * Mocking helper that uses OpenAPI-aligned structure (simulated here)
   */
  async mockOrderDetails(id: string, vehicle: { make: string; model: string }) {
    await this.page.route(`**/api/workshop/orders/${id}`, async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id,
          order_number: `SO-TEST-${id}`,
          status: 'OPEN',
          customer: { id: 'CUST-1', first_name: 'Test', last_name: 'User' },
          vehicle: { id: 'VEH-1', ...vehicle, year: 2020, plate: 'TEST-1' },
          tasks: [
            { id: 'TASK-1', title: 'General Inspection', status: 'NOT_STARTED', done: false, lineItems: [] }
          ],
        }),
      });
    });
  }
}
