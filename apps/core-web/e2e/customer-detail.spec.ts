import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockVehicle,
  createMockCustomerDetailResponse,
} from './utils/mock-factories';
import { DE_CUSTOMERS } from './helpers/de-customers';

/**
 * Blueprint Validation Suite — Customer Detail Page
 *
 * Tests cover:
 *   1. Detail page load with header (customer name, type badge, contact info card).
 *   2. Active Orders tab rendering with sales + workshop orders.
 *   3. Invoice History tab rendering.
 *   4. Vehicles tab rendering with clickable vehicle rows.
 *   5. Inline-edit save-on-blur for contact fields.
 *   6. Empty-state rendering when no orders/invoices/vehicles exist.
 *
 * All API calls are mocked so tests are deterministic and do not depend
 * on database seed state.
 */

const CUSTOMER_ID = 'cust-detail-001';

test.describe('Blueprint: Customer Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
  });

  test('renders customer header with name, type badge, and contact info card', async ({
    page,
  }) => {
    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      first_name: 'Jane',
      last_name: 'Smith',
      type: 'PRIVATE',
      email: 'jane.smith@example.com',
      phone: '+43 123 456 789',
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Header shows the customer name
    await expect(page.getByRole('heading', { name: 'Jane Smith' })).toBeVisible();

    // Contact Information card is visible
    await expect(page.getByText(DE_CUSTOMERS.detail.contactInformation)).toBeVisible();

    // Email and phone rendered
    await expect(page.getByText('jane.smith@example.com')).toBeVisible();
    await expect(page.getByText('+43 123 456 789')).toBeVisible();
  });

  test('renders company customer with company badge', async ({ page }) => {
    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      type: 'COMPANY',
      company_name: 'Acme Motors GmbH',
      first_name: 'Max',
      last_name: 'Mustermann',
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Company name in heading
    await expect(page.getByRole('heading', { name: 'Acme Motors GmbH' })).toBeVisible();

    // Company badge visible (exact match to avoid hitting "Company Name" label)
    await expect(page.getByText(DE_CUSTOMERS.detail.companyBadge, { exact: true })).toBeVisible();
  });

  test('renders Active Orders tab with sales and workshop orders', async ({ page }) => {
    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      first_name: 'Jane',
      last_name: 'Smith',
      sales_orders: [
        {
          id: 'so-1',
          order_number: 'SO-2026-0042',
          status: 'CONFIRMED',
          total_amount: '250.00',
          createdAt: '2026-04-10T10:00:00Z',
        },
      ],
      workshop_orders: [
        {
          id: 'ws-1',
          order_number: 'WO-2026-0015',
          status: 'IN_PROGRESS',
          createdAt: '2026-04-12T14:00:00Z',
          tasks: [
            {
              lineItems: [{ quantity: 2, unitPrice: 50 }],
            },
          ],
        },
      ],
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Active Orders tab is default — verify both orders render
    await expect(page.getByText('SO-2026-0042')).toBeVisible();
    await expect(page.getByText('WO-2026-0015')).toBeVisible();

    // Type column shows Sales and Service
    await expect(page.getByRole('cell', { name: DE_CUSTOMERS.detail.orderTypes.sales })).toBeVisible();
    await expect(page.getByRole('cell', { name: DE_CUSTOMERS.detail.orderTypes.service })).toBeVisible();
  });

  test('renders Invoice History tab with invoice rows', async ({ page }) => {
    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      first_name: 'Jane',
      last_name: 'Smith',
      invoices: [
        {
          id: 'inv-1',
          invoice_number: 'RE-2026-0008',
          status: 'PAID',
          date: '2026-03-15T00:00:00Z',
          total_gross: '1250.00',
        },
      ],
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Switch to Invoice History tab
    await page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.invoices }).click();

    // Invoice row visible
    await expect(page.getByText('RE-2026-0008')).toBeVisible();
  });

  test('renders Vehicles tab with vehicle rows', async ({ page }) => {
    const vehicle = createMockVehicle({
      id: 'veh-detail-1',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2022,
      plate: 'W-12345',
    });

    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      first_name: 'Jane',
      last_name: 'Smith',
      vehicles: [{ ...vehicle, vin: 'WVWZZZ1JZXW000001' }],
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Switch to Vehicles tab
    await page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.vehicles }).click();

    // Vehicle data visible
    await expect(page.getByText('Volkswagen')).toBeVisible();
    await expect(page.getByText('Golf')).toBeVisible();
    await expect(page.getByText('W-12345')).toBeVisible();
    await expect(page.getByText('WVWZZZ1JZXW000001')).toBeVisible();
  });

  test('renders vehicle parties by role on the Vehicles tab', async ({ page }) => {
    const owned = createMockVehicle({ id: 'veh-owner-1', make: 'Skoda', model: 'Octavia', year: 2021, plate: 'W-OWNER1' });
    const formerly = createMockVehicle({ id: 'veh-prev-1', make: 'Opel', model: 'Corsa', year: 2015, plate: 'W-PREV1' });

    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      first_name: 'Jane',
      last_name: 'Smith',
      vehicle_parties: [
        {
          id: 'party-owner-1',
          vehicle_id: owned.id,
          role: 'OWNER',
          valid_from: '2026-01-01',
          valid_to: null,
          source: 'MANUAL',
          is_active: true,
          vehicle: { id: owned.id, make: owned.make, model: owned.model, plate: owned.plate },
        },
        {
          id: 'party-prev-1',
          vehicle_id: formerly.id,
          role: 'PREVIOUS_OWNER',
          valid_from: '2020-01-01',
          valid_to: '2024-12-31',
          source: 'LEGACY_IMPORT',
          is_active: false,
          vehicle: { id: formerly.id, make: formerly.make, model: formerly.model, plate: formerly.plate },
        },
      ],
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.vehicles }).click();

    const tabPanel = page.getByRole('tabpanel');
    await expect(tabPanel.getByText('Skoda Octavia')).toBeVisible();
    await expect(tabPanel.getByText('Halter')).toBeVisible();
    await expect(tabPanel.getByText('Opel Corsa')).toBeVisible();
    await expect(tabPanel.getByText('Altbesitzer')).toBeVisible();
    await expect(tabPanel.getByText('Beendet')).toBeVisible();
  });

  test('renders empty states for all tabs when customer has no orders/invoices/vehicles', async ({
    page,
  }) => {
    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      first_name: 'New',
      last_name: 'Customer',
      sales_orders: [],
      workshop_orders: [],
      invoices: [],
      vehicles: [],
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Active Orders tab — empty state
    await expect(page.getByText(DE_CUSTOMERS.detail.tables.noActiveOrders)).toBeVisible();

    // Invoice History tab — empty state
    await page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.invoices }).click();
    await expect(page.getByText(DE_CUSTOMERS.detail.tables.noRecentInvoices)).toBeVisible();

    // Vehicles tab — empty state
    await page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.vehicles }).click();
    await expect(page.getByText(DE_CUSTOMERS.detail.tables.noVehiclesRegistered)).toBeVisible();
  });

  test('inline edit triggers PATCH to /api/customers/:id on blur', async ({ page }) => {
    let detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'old@example.com',
    });

    // Mock GET — detail load
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detail),
        });
      } else if (method === 'PATCH') {
        // Return the updated customer
        const patchBody = route.request().postDataJSON();
        detail = { ...detail, ...patchBody };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detail),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Click the displayed email text to enter editing mode.
    // InlineEdit renders a <button> wrapping the display value; the aria-labelled
    // <input> only appears after clicking.
    await page.getByText('old@example.com').click();

    // The InlineEdit now shows an <Input> with aria-label="Customer email"
    const input = page.getByLabel(DE_CUSTOMERS.detail.aria.email);
    await expect(input).toBeVisible();
    // InlineEdit focuses the input and places the caret in a requestAnimationFrame after it mounts.
    // Wait for that focus: otherwise the deferred caret placement can collapse fill()'s selection and
    // the new value is appended to the old one (old@example.comnew.email@example.com).
    await expect(input).toBeFocused();

    // Set up response listener BEFORE changing the value (listener-first pattern)
    const patchPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/customers/${CUSTOMER_ID}`) &&
        res.request().method() === 'PATCH',
    );

    await input.fill('new.email@example.com');

    // Blur to trigger save-on-blur → PATCH
    await input.blur();

    // PATCH should fire
    const response = await patchPromise;
    expect(response.status()).toBe(200);

    // Verify the request payload contained the updated email field
    const requestBody = response.request().postDataJSON() as Record<string, unknown>;
    expect(requestBody).toMatchObject({ email: 'new.email@example.com' });

    // Verify the UI reflects the saved value
    await expect(page.getByText('new.email@example.com')).toBeVisible();
  });
});
