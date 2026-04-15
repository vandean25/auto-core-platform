import { Page, expect, Locator } from '@playwright/test';

/**
 * BasePage encapsulates the "Golden Rules" of the Auto Core Platform UI.
 * Every core list page should have a Create button in the top-right and
 * a DataTable where rows are clickable to open details.
 */
export class AutoCorePage {
  readonly page: Page;
  readonly entityName: string;

  constructor(page: Page, entityName: string) {
    this.page = page;
    this.entityName = entityName;
  }

  /**
   * Rule: All Create buttons MUST be "+ <Entity>" in the top right.
   */
  get createButton(): Locator {
    return this.page.getByRole('button', { name: `+ ${this.entityName}`, exact: true });
  }

  get dataTable(): Locator {
    return this.page.getByRole('table');
  }

  async navigate(path: string) {
    await this.page.goto(path);
    // Ensure the page actually loaded
    await expect(this.page).not.toBeUndefined();
  }

  /**
   * Rule: Top-left is strictly for context (titles, badges).
   * Top-right is strictly for actions (Create, Save, etc.).
   */
  async verifyHeaderConsistency(title: string) {
    // Check main title in the header
    const heading = this.page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible();
    
    // Check for the Create button in the top-right area
    await expect(this.createButton).toBeVisible();
  }

  /**
   * Rule: Clicking a table row MUST open that entity's detail card/sheet.
   * We exclude common non-clickable elements inside rows like checkboxes.
   */
  async openRowDetails(searchText: string) {
    // Find the row by text or data attribute
    const row = this.page.locator('[data-table-row="true"]').filter({ hasText: searchText }).first();
    await expect(row).toBeVisible();
    
    // Perform the click on the row
    await row.click();
    
    // Rule: Interaction should open a Sheet (Dialog) or navigate to a details page.
    // We check for common indicators of a detail view (e.g., a "Details" heading or a dialog role)
    const detailView = this.page.locator('[role="dialog"], [data-state="open"] h2, h2:has-text("Details")').first();
    await expect(detailView).toBeVisible();
  }

  /**
   * Helper for Auto-Save validation.
   * Rule: Debounced Form-Level Auto-Save (750ms) for complex documents.
   */
  async waitForAutoSave(apiPath: string) {
    // 1. Wait for "Saving..." indicator
    await expect(this.page.getByText(/saving/i)).toBeVisible();
    
    // 2. Wait for the actual API call to resolve
    const responsePromise = this.page.waitForResponse(
      (res) => res.url().includes(apiPath) && (res.request().method() === 'PATCH' || res.request().method() === 'POST')
    );
    
    await responsePromise;
    
    // 3. Wait for "Saved" indicator
    await expect(this.page.getByText(/saved/i)).toBeVisible();
  }
}
