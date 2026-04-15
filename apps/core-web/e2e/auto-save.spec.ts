import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';

test.describe('Form Auto-Save Hardening', () => {
  const BILL_ID = 'bill-save-test-123';
  const VENDOR_ID = 'vendor-123';

  test('should auto-save bill changes after debounce', async ({ page }) => {
    // 1. Mock the initial Purchase Invoice in DRAFT status
    await page.route(`**/api/purchase-invoices/${BILL_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: BILL_ID,
          vendor_id: VENDOR_ID,
          vendor_invoice_number: 'B-OLD-123',
          status: 'DRAFT',
          invoice_date: new Date().toISOString(),
          due_date: new Date().toISOString(),
          total_amount: '0.00',
          lines: [],
          vendor: {
            id: VENDOR_ID,
            name: 'Bosch Automotive',
          }
        }),
      });
    });

    // 2. Mock Vendor details
    await page.route(`**/api/vendors/${VENDOR_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: VENDOR_ID,
          name: 'Bosch Automotive',
          supportedBrands: [{ id: 'b1', name: 'Bosch' }],
        }),
      });
    });

    // 3. Mock the PATCH request for auto-save
    let saveTriggered = false;
    await page.route(`**/api/purchase-invoices/${BILL_ID}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        saveTriggered = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: BILL_ID, vendor_invoice_number: 'B-NEW-789', status: 'DRAFT' }),
        });
      } else {
        await route.continue();
      }
    });

    // 4. Navigate to the edit page
    await page.goto(`/purchase-bills/${BILL_ID}`);

    // Wait for the form to load
    const input = page.getByLabel('Vendor Bill #');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('B-OLD-123');

    // 5. Fill the field to trigger debounce
    await input.fill('B-NEW-789');

    // 6. Verify "Saving..." indicator appears
    await expect(page.getByText(/saving/i)).toBeVisible();

    // 7. Verify the PATCH request was sent and "Saved" indicator appears
    await expect(page.getByText(/All changes saved/i)).toBeVisible();
    
    expect(saveTriggered).toBe(true);
  });
});
