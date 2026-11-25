import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockVehicle,
  createMockCustomerDetailResponse,
} from './utils/mock-factories';
import { DE_CUSTOMERS } from './helpers/de-customers';
import { PHONE_WIDTHS } from './utils/phone-layout';

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
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { nextCursor: null, hasNextPage: false, limit: 25 } }),
      });
    });
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/notes`)), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
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

    // Switch to Active Orders tab
    await page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.activeOrders }).click();

    // Verify both orders render
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

    // Verlauf tab (default) — empty state
    await expect(page.getByText(DE_CUSTOMERS.activity.empty)).toBeVisible();

    // Active Orders tab — empty state
    await page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.activeOrders }).click();
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

// AUT-883 validation: the display button is 44px, but the open editor shrank to the 36px default input height.
test.describe('Customer contact editor on a phone (AUT-883)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`${width}px: the open inline editor is a 44px touch target`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockCustomerDetailResponse({ id: CUSTOMER_ID, phone: '+43 123 456 789' })),
        }),
      );
      await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], meta: { nextCursor: null, hasNextPage: false, limit: 25 } }),
        }),
      );
      await page.goto(`/customers/${CUSTOMER_ID}`);

      await page.getByRole('button', { name: '+43 123 456 789' }).click();

      const editor = page.getByRole('textbox', { name: DE_CUSTOMERS.detail.aria.phone });
      expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  }
});

test.describe('Customer activity timeline (AUT-1039)', () => {
  const sampleItems = [
    {
      id: 'inv-1',
      type: 'invoice',
      occurred_at: '2026-11-20T10:00:00.000Z',
      title: 'RE-2026-0042',
      ref_id: 'inv-1',
      ref_link: '/sales/invoices/inv-1',
      summary: { status: 'FINALIZED', total_gross: 240 },
    },
    {
      id: 'cn-1',
      type: 'credit_note',
      occurred_at: '2026-11-19T14:00:00.000Z',
      title: 'GS-2026-0005',
      ref_id: 'cn-1',
      ref_link: '/finance/credit-notes/cn-1',
      summary: { status: 'FINALIZED', total_gross: 50, reason: 'Kulanz' },
    },
    {
      id: 'wo-1',
      type: 'workshop_order',
      occurred_at: '2026-11-18T09:00:00.000Z',
      title: 'WO-2026-0015',
      ref_id: 'wo-1',
      ref_link: '/workshop/orders/wo-1',
      summary: { status: 'INVOICED', vehicle: 'VW Golf (W-123AB)' },
    },
  ];

  test('opens Verlauf tab by default with items newest first', async ({ page }, testInfo) => {
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockCustomerDetailResponse({ id: CUSTOMER_ID, first_name: 'Jane', last_name: 'Smith' })),
      }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: sampleItems, meta: { nextCursor: null, hasNextPage: false, limit: 25 } }),
      }),
    );

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await expect(page.getByRole('tab', { name: DE_CUSTOMERS.detail.tabs.activity, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('RE-2026-0042')).toBeVisible();
    await expect(page.getByText('WO-2026-0015')).toBeVisible();

    await testInfo.attach('customer-activity-default-de-desktop', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('filters by Rechnungen chip and persists filter in URL', async ({ page }, testInfo) => {
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockCustomerDetailResponse({ id: CUSTOMER_ID, first_name: 'Jane', last_name: 'Smith' })),
      }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), (route) => {
      const url = new URL(route.request().url());
      const types = url.searchParams.get('types');
      const filtered = types
        ? sampleItems.filter((item) => types.split(',').includes(item.type))
        : sampleItems;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: filtered, meta: { nextCursor: null, hasNextPage: false, limit: 25 } }),
      });
    });

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await page.getByRole('button', { name: DE_CUSTOMERS.activity.filters.invoices }).click();

    await expect(page).toHaveURL(/types=invoice(%2C|,)credit_note/);
    await expect(page.getByText('RE-2026-0042')).toBeVisible();
    await expect(page.getByText('GS-2026-0005')).toBeVisible();
    await expect(page.getByText('WO-2026-0015')).not.toBeVisible();

    await testInfo.attach('customer-activity-invoices-filter-de-desktop', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('375px: filter chips and record links meet 44px tap target without horizontal overflow', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockCustomerDetailResponse({ id: CUSTOMER_ID, first_name: 'Jane', last_name: 'Smith' })),
      }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: sampleItems, meta: { nextCursor: null, hasNextPage: false, limit: 25 } }),
      }),
    );

    await page.goto(`/customers/${CUSTOMER_ID}`);
    const invoicesChip = page.getByRole('button', { name: DE_CUSTOMERS.activity.filters.invoices });
    await expect(invoicesChip).toBeVisible();
    expect((await invoicesChip.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const openLink = page.getByRole('link', { name: DE_CUSTOMERS.activity.openRecord }).first();
    expect((await openLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);

    await openLink.scrollIntoViewIfNeeded();
    await expect(invoicesChip).toBeInViewport();
    await expect(openLink).toBeInViewport();

    await testInfo.attach('customer-activity-mobile-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});

test.describe('Customer Notes (AUT-1040)', () => {
  test('Scenario 1, 2 & 3: shows Art 9 hint, pinned notes on top, and Notiz in Verlauf (desktop + 375px)', async ({ page }, testInfo) => {
    const notes = [
      {
        id: 'note-1',
        customer_id: CUSTOMER_ID,
        body: 'Wichtige Notiz für den Kunden',
        pinned: true,
        author_member_id: 'mem-1',
        author_role: 'SALES',
        retention_class: 'OPERATIONAL',
        retain_until: '2029-11-25T10:00:00.000Z',
        legal_hold: false,
        created_at: '2026-11-25T10:00:00.000Z',
        updated_at: '2026-11-25T10:00:00.000Z',
      },
      {
        id: 'note-2',
        customer_id: CUSTOMER_ID,
        body: 'Normale Notiz',
        pinned: false,
        author_member_id: 'mem-1',
        author_role: 'SALES',
        retention_class: 'OPERATIONAL',
        retain_until: '2029-11-25T10:00:00.000Z',
        legal_hold: false,
        created_at: '2026-11-25T11:00:00.000Z',
        updated_at: '2026-11-25T11:00:00.000Z',
      },
    ];

    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockCustomerDetailResponse({ id: CUSTOMER_ID, first_name: 'Jane', last_name: 'Smith' })),
      }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/notes`)), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: notes }) }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'note-1',
              type: 'customer_note',
              occurred_at: '2026-11-25T10:00:00.000Z',
              title: 'Wichtige Notiz für den Kunden',
              ref_id: 'note-1',
              ref_link: null,
              summary: { pinned: true, author_role: 'SALES', retention_class: 'OPERATIONAL' },
            },
          ],
          meta: { nextCursor: null, hasNextPage: false, limit: 25 },
        }),
      }),
    );

    await page.goto(`/customers/${CUSTOMER_ID}`);
    const notesCard = page.getByTestId('customer-notes-card');
    const legalHint = page.getByTestId('customer-note-legal-hint');
    const notesList = page.getByTestId('customer-notes-list');
    const notizChip = page.getByRole('button', { name: 'Notiz', exact: true });

    await expect(notesCard).toBeVisible();
    await expect(legalHint).toContainText('Art. 9 DSGVO');
    const items = notesList.locator('li');
    await expect(items.first()).toHaveAttribute('data-pinned', 'true');
    await expect(items.nth(1)).toHaveAttribute('data-pinned', 'false');
    await expect(notizChip).toBeVisible();

    await notesCard.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(notesCard).toBeInViewport();
    await expect(legalHint).toBeInViewport();
    await expect(notesList).toBeInViewport();
    await expect(items.first()).toBeInViewport();
    await expect(items.nth(1)).toBeInViewport();

    await testInfo.attach('customer-notes-pinned-and-hint-de-desktop', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    await page.setViewportSize({ width: 375, height: 812 });
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
    await notesCard.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect(notesCard).toBeInViewport();
    await expect(legalHint).toBeInViewport();
    await expect(notesList).toBeInViewport();
    await expect(page.getByRole('button', { name: DE_CUSTOMERS.notes.addAction })).toBeInViewport();
    await expect(page.getByRole('button', { name: DE_CUSTOMERS.notes.editAction }).first()).toBeInViewport();
    await expect(page.getByRole('button', { name: DE_CUSTOMERS.notes.deleteAction }).first()).toBeInViewport();
    await testInfo.attach('customer-notes-mobile-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('Scenario 3 (EN): shows Art 9 GDPR hint in English on open note field', async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.setItem('acp:ui-language', 'en'));
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockCustomerDetailResponse({ id: CUSTOMER_ID, first_name: 'Jane', last_name: 'Smith' })),
      }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/notes`)), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { nextCursor: null, hasNextPage: false, limit: 25 } }),
      }),
    );

    await page.goto(`/customers/${CUSTOMER_ID}`);
    const notesCard = page.getByTestId('customer-notes-card');
    const legalHint = page.getByTestId('customer-note-legal-hint');
    await expect(notesCard).toBeVisible();
    await expect(legalHint).toContainText('Art. 9 GDPR');
    await notesCard.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(legalHint).toBeInViewport();

    await testInfo.attach('customer-notes-hint-en-desktop', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('Scenario 9: ACCOUNTING role hides notes card and Notiz filter chip', async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.setItem('e2e-active-role', 'ACCOUNTING'));
    await page.route(AutoCorePage.apiRouteMatcher('/api/auth/session'), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 'user-acct',
          email: 'acct@example.com',
          tenantId: 'tenant-1',
          activeRole: 'ACCOUNTING',
          activeSiteId: 'site-1',
          defaultLocale: 'de',
          preferredLocale: null,
          customFieldsEnabled: false,
          memberships: [{ tenantId: 'tenant-1', tenantName: 'Test', role: 'ACCOUNTING' }],
        }),
      }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/tyre-sets\/by-customer\/.*/), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockCustomerDetailResponse({ id: CUSTOMER_ID, first_name: 'Jane', last_name: 'Smith' })),
      }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(new RegExp(`/api/customers/${CUSTOMER_ID}/activity`)), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { nextCursor: null, hasNextPage: false, limit: 25 } }),
      }),
    );

    await page.goto(`/customers/${CUSTOMER_ID}`);
    await expect(page.getByText(DE_CUSTOMERS.detail.contactInformation)).toBeVisible();
    await expect(page.getByTestId('customer-notes-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Notiz', exact: true })).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByText(DE_CUSTOMERS.activity.empty)).toBeVisible();

    await testInfo.attach('customer-notes-accounting-hidden-de', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});
