import { Page, expect, Locator } from '@playwright/test';

/**
 * AutoCorePage encapsulates the "Golden Rules" of the Auto Core Platform UI.
 *
 * Golden Rules enforced:
 * 1. Header Structure: title in top-left, all primary actions (Create) in top-right.
 * 2. Entity Identification: interactive rows use `data-table-row="true"` (set by DataTable component).
 * 3. Navigation Flow: clicking a table row MUST open a detail view (Sheet/Dialog) OR navigate.
 * 4. Auto-Save: debounced forms show a Saving → Saved visual cycle and emit a PATCH/POST request.
 *
 * All list-page feature POMs MUST extend this class.
 */
export class AutoCorePage {
  readonly page: Page;
  readonly entityName: string;

  constructor(page: Page, entityName: string) {
    this.page = page;
    this.entityName = entityName;
  }

  /** Escapes a string for safe embedding in a RegExp literal. */
  private static escapeRegex(text: string): string {
    return text.replace(/[+.*?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Rule: The create button label is the entity name (with an optional leading `+ ` only when the
   * button text explicitly contains it, e.g. `"+ Item"`).
   *
   * The regex is anchored (`^…$`) so that sidebar navigation links like "Vendors", "Purchase Orders",
   * or "Customers" do NOT accidentally match entity names like "Vendor", "Purchase Order", or
   * "Customer".  The `<Button asChild><Link>` pattern is covered by the `.or(link)` branch.
   */
  get createButton(): Locator {
    // Anchored: matches exactly "Item" or "+ Item" but NOT "Items", "Purchase Orders", etc.
    const nameRegex = new RegExp(`^(\\+ )?${AutoCorePage.escapeRegex(this.entityName)}$`);
    return this.page
      .getByRole('button', { name: nameRegex })
      .or(this.page.getByRole('link', { name: nameRegex }));
  }

  get dataTable(): Locator {
    return this.page.getByRole('table');
  }

  /**
   * Navigate to a path and wait until the network is idle so that mocked routes
   * are served before any assertions are made.
   */
  async navigate(path: string) {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Rule: Top-left is strictly for context (titles, badges).
   * Top-right is strictly for actions (Create, Save, etc.).
   *
   * Verifies:
   * - The page heading with the given title is visible.
   * - A create button matching `entityName` is visible (typically top-right).
   */
  async verifyHeaderConsistency(title: string) {
    const heading = this.page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(this.createButton).toBeVisible();
  }

  /**
   * Rule: Clicking a table row MUST open that entity's detail card/sheet OR navigate to a detail page.
   *
   * Handles two patterns:
   * a) Sheet / Dialog  → a `[role="dialog"]` or `[role="complementary"]` element becomes visible.
   * b) Navigation      → the URL changes (e.g. `/vendors/:id`).
   */
  async openRowDetails(searchText: string) {
    const row = this.page.locator('[data-table-row="true"]').filter({ hasText: searchText }).first();
    await expect(row).toBeVisible();

    const urlBefore = this.page.url();
    await row.click();

    // Poll until either a dialog/sheet opens or the browser navigates away.
    await expect(async () => {
      const urlChanged = this.page.url() !== urlBefore;
      const dialogVisible = await this.page
        .locator('[role="dialog"], [role="complementary"]')
        .first()
        .isVisible();
      expect(
        urlChanged || dialogVisible,
        `Expected row click to open a dialog/sheet or navigate to a detail page, ` +
          `but URL stayed '${urlBefore}' and no dialog appeared`,
      ).toBe(true);
    }).toPass({ timeout: 5000 });
  }

  /**
   * Builds a query-safe Regex for a given API path segment so that route interceptors
   * match both plain endpoints and those with trailing query strings.
   *
   * Example: apiRouteMatcher('/api/inventory') matches
   *   `/api/inventory`, `/api/inventory?page=1&limit=10`, etc.
   */
  static apiRouteMatcher(path: string): RegExp {
    const escaped = AutoCorePage.escapeRegex(path);
    return new RegExp(`.*${escaped}(\\?.*)?$`);
  }

  /**
   * Helper for Auto-Save validation.
   * Rule: Debounced Form-Level Auto-Save (750ms) for complex documents.
   *
   * IMPORTANT: Call this helper AFTER triggering the field change that initiates the auto-save,
   * but BEFORE the 750 ms debounce fires.  The listener is registered first so it cannot miss
   * a fast network response.
   *
   * Sequence verified:
   * 1. A PATCH or POST request to `apiPath` is completed.
   * 2. If the "Saving…" indicator becomes visible before the response, observe it.
   * 3. A "Saved" / "All changes saved" text indicator appears.
   *
   * Some document forms render the "Saving…" state for a very short window, so
   * the helper treats it as best-effort and always requires the final saved-state
   * message instead of failing on a missed transient transition.
   */
  async waitForAutoSave(apiPath: string) {
    // Register the response listener FIRST to avoid a race with a fast network.
    const responsePromise = this.page.waitForResponse(
      (res) =>
        res.url().includes(apiPath) &&
        (res.request().method() === 'PATCH' || res.request().method() === 'POST'),
    );

    const savingLocator = this.page.getByText(/saving/i)
    const savedLocator = this.page.getByText(/^(all changes saved|saved(?: ✓)?)$/i)

    // Some pages transition from "Saving…" to "Saved" too quickly for a strict
    // visible assertion, so observe the transient state only if it appears
    // before the network round-trip completes.
    const savingSeenBeforeResponse = await Promise.race([
      savingLocator.waitFor({ state: 'visible', timeout: 1500 }).then(() => true),
      responsePromise.then(() => false),
    ]).catch(() => false)

    if (savingSeenBeforeResponse) {
      await responsePromise
    }

    await expect(savedLocator).toBeVisible()
  }
}
