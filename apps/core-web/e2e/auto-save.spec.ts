import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockListResponse,
  createMockPurchaseBill,
  createMockVendor,
} from './utils/mock-factories';

/**
 * Auto-Save Hardening Suite
 *
 * Golden Rule: Complex document forms (Purchase Bills, Sales Orders, etc.) MUST
 * use a Debounced Form-Level Auto-Save (750 ms) and show a "Saving…" → "Saved"
 * visual indicator to confirm the save cycle.
 *
 * Pattern enforced here:
 *   1. Mock API BEFORE navigating (network isolation — mock-first-then-navigate).
 *   2. Trigger a field change to start the debounce timer.
 *   3. Use `AutoCorePage.waitForAutoSave` to verify the complete Saving → network
 *      round-trip → Saved cycle.
 */
test.describe('Blueprint: Auto-Save Hardening', () => {
  const BILL_ID = 'bill-save-test-123';
  const VENDOR_ID = 'vendor-auto-save-123';

  test('should auto-save a Purchase Bill field change after the debounce', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Bill');

    const initialBill = createMockPurchaseBill({
      id: BILL_ID,
      vendor_invoice_number: 'B-OLD-123',
      vendor: createMockVendor({ id: VENDOR_ID, name: 'Bosch Automotive' }),
    });
    const vendor = createMockVendor({
      id: VENDOR_ID,
      name: 'Bosch Automotive',
      supportedBrands: [{ id: 1, name: 'Bosch' }],
    });

    // ── Step 1: Register all mocks BEFORE navigating ────────────────────────

    // GET /api/purchase-invoices/:id  →  return the initial DRAFT bill
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-invoices/${BILL_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          await new Promise((resolve) => setTimeout(resolve, 150));

          // PATCH: auto-save — return the updated bill
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...initialBill,
              vendor_invoice_number: 'B-NEW-789',
            }),
          });
        } else {
          // GET: initial load
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(initialBill),
          });
        }
      },
    );

    // GET /api/vendors/:id  →  vendor detail (loaded by the bill form)
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/vendors/${VENDOR_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(vendor),
        });
      },
    );

    // GET /api/vendors  →  vendor combobox list
    await page.route(AutoCorePage.apiRouteMatcher('/api/vendors'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([vendor])),
      });
    });

    // GET /api/vendors/:id/unbilled-receipts  →  no pending receipts for this bill
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/vendors/${VENDOR_ID}/unbilled-receipts`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      },
    );

    // ── Step 2: Navigate (network-idle is handled by corePage.navigate) ──────
    await corePage.navigate(`/purchase-bills/${BILL_ID}`);

    // ── Step 3: Confirm the form loaded with the initial value ──────────────
    const input = page.getByLabel('Vendor Bill #');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('B-OLD-123');

    // ── Step 4: Start the auto-save listener BEFORE filling the field ────────
    // waitForAutoSave registers a network response listener internally, so we
    // must create the promise BEFORE triggering the fill.  Filling the field
    // starts the 750 ms debounce; the listener will catch the PATCH request
    // that fires after the debounce elapses.
    const autoSavePromise = corePage.waitForAutoSave('/api/purchase-invoices');
    await input.fill('B-NEW-789');

    // ── Step 5: Verify the complete Saving → network round-trip → Saved cycle
    await autoSavePromise;

    // Extra assertion: the field should reflect the saved value
    await expect(input).toHaveValue('B-NEW-789');
  });
});
