import { expect, test } from '@playwright/test';
import { DE_SHELL } from './helpers/de-shell';
import { DE_CUSTOMERS } from './helpers/de-customers';
import { AutoCorePage } from './pom/AutoCorePage';
import { expectNoAxeViolationsForRules } from './utils/a11y';
import { createMockListResponse, createMockSalesOrder } from './utils/mock-factories';

/**
 * AUT-473: every routed page sets its own document title (WCAG 2.4.2), and detail pages add their
 * entity number. Route changes are announced to assistive tech without moving focus (WCAG 4.1.3).
 */

function jsonResponse(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

test.describe('Per-route document title (AUT-473)', () => {
  test('customers list is titled and passes axe document-title', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), (route) =>
      route.fulfill(jsonResponse(createMockListResponse([]))),
    );
    await new AutoCorePage(page, 'Customer').navigate('/customers');

    await expect(page).toHaveTitle(/Kunden - Auto Core/);
    await expectNoAxeViolationsForRules(page, ['document-title']);
  });

  const keyRoutes = [
    { path: '/dashboard', title: 'Dashboard - Auto Core' },
    { path: '/workshop/orders', title: 'Werkstattaufträge - Auto Core' },
    { path: '/sales-orders', title: 'Kundenaufträge - Auto Core' },
    { path: '/settings', title: 'Einstellungen - Auto Core' },
  ];

  for (const { path, title } of keyRoutes) {
    test(`${path} is titled "${title}" and passes axe document-title`, async ({ page }) => {
      await new AutoCorePage(page, 'Page').navigate(path);

      await expect(page).toHaveTitle(title);
      await expectNoAxeViolationsForRules(page, ['document-title']);
    });
  }

  test('sales order detail adds its order number to the title', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/sales-orders/so-123'), (route) =>
      route.fulfill(jsonResponse({ ...createMockSalesOrder(), items: [] })),
    );
    await new AutoCorePage(page, 'Sales Order').navigate('/sales-orders/so-123');

    await expect(page).toHaveTitle('SO-2026-0001 - Kundenaufträge - Auto Core');
    await expectNoAxeViolationsForRules(page, ['document-title']);
  });

  test('loaner booking print page adds the booking id to the title', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/loaner-bookings/booking-1'), (route) =>
      route.fulfill(
        jsonResponse({
          id: 'booking-1',
          loanerVehicleId: 'loaner-1',
          workshopOrderId: null,
          customerId: 'cust-1',
          plannedFrom: '2026-10-10T08:00:00.000Z',
          plannedTo: '2026-10-12T18:00:00.000Z',
          status: 'RESERVED',
          handedOverAt: null,
          returnedAt: null,
          odometerOut: null,
          odometerIn: null,
          fuelOut: null,
          fuelIn: null,
          driverLicenceChecked: false,
          licenceCheckedById: null,
          notes: null,
          createdAt: '2026-10-09T10:00:00.000Z',
          updatedAt: '2026-10-09T10:00:00.000Z',
          customer: { id: 'cust-1', firstName: 'Test', lastName: 'Customer', companyName: null },
        }),
      ),
    );
    await new AutoCorePage(page, 'Loaner Booking').navigate('/workshop/loaner-bookings/booking-1/print');

    await expect(page).toHaveTitle('booking-1 - Ersatzwagen Protokoll - Auto Core');
    await expectNoAxeViolationsForRules(page, ['document-title']);
  });

  test('route changes are announced and focus stays on the link that was activated', async ({ page }) => {
    await new AutoCorePage(page, 'Page').navigate('/dashboard');
    const customersLink = page.getByRole('link', { name: DE_SHELL.modules.customers, exact: true }).first();

    await customersLink.click();

    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByText('Navigiert zu Kunden', { exact: true })).toHaveAttribute('aria-live', 'polite');
    await expect(customersLink).toBeFocused();
  });

  test('leaving a detail page does not keep its entity in the next page title', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/sales-orders/so-123'), (route) =>
      route.fulfill(jsonResponse({ ...createMockSalesOrder(), items: [] })),
    );
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), (route) =>
      route.fulfill(jsonResponse(createMockListResponse([]))),
    );
    await new AutoCorePage(page, 'Sales Order').navigate('/sales-orders/so-123');
    await expect(page).toHaveTitle('SO-2026-0001 - Kundenaufträge - Auto Core');

    await page.getByRole('link', { name: DE_SHELL.modules.customers, exact: true }).first().click();

    // The list page mounts only after the outgoing page's exit animation has finished, so once its
    // heading is visible any stale write from the outgoing page has already happened.
    await expect(page.getByRole('heading', { name: DE_CUSTOMERS.list.title, exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Kunden - Auto Core');
  });
});
