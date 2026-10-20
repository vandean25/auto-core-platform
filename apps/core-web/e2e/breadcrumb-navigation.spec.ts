import { expect, test, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { expectNoCriticalA11yViolations, expectNoHeadingOrderViolations } from './utils/a11y';
import {
  createMockCustomerDetailResponse,
  createMockListResponse,
  createMockSalesOrder,
  createMockWorkshopOrder,
} from './utils/mock-factories';
import { DE_SHELL } from './helpers/de-shell';
import { DE_CUSTOMERS } from './helpers/de-customers';

/**
 * AUT-475: navigation on the detail pages. The sidebar lists Invoices next to Sales Orders, the
 * detail pages publish a breadcrumb trail back to their list, and a customer page starts a sales
 * order (invoices come from orders, not from the customer page). All API calls are mocked so the
 * tests do not depend on seed data.
 */

const SALES_ORDER_ID = 'so-nav-1';
const INVOICE_ID = 'inv-nav-1';
const CUSTOMER_ID = 'cust-nav-1';
const WORKSHOP_ORDER_ID = 'wo-nav-1';

const finalizedInvoice = {
  id: INVOICE_ID,
  status: 'FINALIZED',
  invoice_number: 'RE-2026-0901',
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  total_net: '100.00',
  total_tax: '20.00',
  total_gross: '120.00',
  tax_mode: 'STANDARD',
  workshop_order_id: null,
  customer: {
    id: CUSTOMER_ID,
    type: 'PRIVATE',
    first_name: 'Jane',
    last_name: 'Doe',
    company_name: null,
    email: 'jane@example.com',
    phone: null,
  },
  items: [],
};

async function mockJson(page: Page, path: string, body: unknown, status = 200) {
  await page.route(AutoCorePage.apiRouteMatcher(path), async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/** The sidebar's main navigation, so assertions do not match breadcrumb links with the same name. */
function mainNavigation(page: Page) {
  return page.getByRole('navigation', { name: DE_SHELL.mainNavigation });
}

function breadcrumbTrail(page: Page) {
  return page.getByRole('navigation', { name: 'Breadcrumb' });
}

test.describe('AUT-475: navigation and breadcrumbs', () => {
  test('sidebar Invoices link is active on the invoice list', async ({ page }) => {
    await mockJson(page, '/api/sales/invoices', createMockListResponse([]));

    await page.goto('/sales/invoices');

    const invoicesLink = mainNavigation(page).getByRole('link', {
      name: DE_SHELL.modules.salesInvoices,
      exact: true,
    });
    await expect(invoicesLink).toHaveAttribute('href', '/sales/invoices');
    await expect(invoicesLink).toHaveAttribute('aria-current', 'page');
    await expect(
      mainNavigation(page).getByRole('link', { name: DE_SHELL.modules.salesOrders, exact: true }),
    ).not.toHaveAttribute('aria-current', 'page');
    await expectNoCriticalA11yViolations(page);
  });

  test('sales order detail: breadcrumb returns to the sales order list', async ({ page }) => {
    // The detail page also reads items and notes, which the shared factory leaves out.
    const order = {
      ...createMockSalesOrder({ id: SALES_ORDER_ID, order_number: 'SO-2026-0901' }),
      items: [],
      notes: null,
    };
    await mockJson(page, `/api/sales-orders/${SALES_ORDER_ID}`, order);
    await mockJson(page, '/api/sales-orders', createMockListResponse([order]));

    await page.goto(`/sales-orders/${SALES_ORDER_ID}`);

    await expect(breadcrumbTrail(page).getByText('SO-2026-0901')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoCriticalA11yViolations(page);
    await expectNoHeadingOrderViolations(page);

    // Breadcrumb list labels still come from route section titles (English).
    await breadcrumbTrail(page).getByRole('link', { name: 'Sales Orders' }).click();

    await expect(page).toHaveURL('/sales-orders');
    await expect(breadcrumbTrail(page)).toHaveCount(0);
    await expect(
      mainNavigation(page).getByRole('link', { name: DE_SHELL.modules.salesOrders, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('invoice detail: breadcrumb returns to the invoice list with Invoices active', async ({ page }) => {
    await mockJson(page, `/api/sales/invoices/${INVOICE_ID}`, finalizedInvoice);
    await mockJson(page, '/api/sales/invoices', createMockListResponse([]));

    await page.goto(`/sales/invoices/${INVOICE_ID}`);

    await expect(breadcrumbTrail(page).getByText('RE-2026-0901')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoCriticalA11yViolations(page);
    await expectNoHeadingOrderViolations(page);

    await breadcrumbTrail(page).getByRole('link', { name: 'Invoices' }).click();

    await expect(page).toHaveURL('/sales/invoices');
    await expect(breadcrumbTrail(page)).toHaveCount(0);
    await expect(
      mainNavigation(page).getByRole('link', { name: DE_SHELL.modules.salesInvoices, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('customer detail offers New sales order and returns to the customer list via breadcrumb', async ({
    page,
  }) => {
    const detail = createMockCustomerDetailResponse({
      id: CUSTOMER_ID,
      type: 'PRIVATE',
      first_name: 'Jane',
      last_name: 'Smith',
    });
    await mockJson(page, `/api/customers/${CUSTOMER_ID}`, detail);
    await mockJson(page, '/api/customers', createMockListResponse([]));

    await page.goto(`/customers/${CUSTOMER_ID}`);

    await expect(page.getByRole('link', { name: DE_CUSTOMERS.detail.newSalesOrder })).toHaveAttribute(
      'href',
      `/sales-orders/new?customerId=${CUSTOMER_ID}`,
    );
    await expect(page.getByText(DE_CUSTOMERS.detail.invoiceHint)).toBeVisible();
    await expect(breadcrumbTrail(page).getByText('Jane Smith')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoCriticalA11yViolations(page);
    await expectNoHeadingOrderViolations(page);

    await breadcrumbTrail(page).getByRole('link', { name: 'Customers' }).click();

    await expect(page).toHaveURL('/customers');
    await expect(breadcrumbTrail(page)).toHaveCount(0);
  });

  test('workshop order detail: breadcrumb returns to the workshop order list', async ({ page }) => {
    const order = createMockWorkshopOrder({ id: WORKSHOP_ORDER_ID, order_number: 'WO-2026-0901' });
    await mockJson(page, `/api/workshop/orders/${WORKSHOP_ORDER_ID}`, order);
    // Estimate load fails on purpose, matching the heading-order spec, so the card is deterministic.
    await mockJson(
      page,
      `/api/workshop/orders/${WORKSHOP_ORDER_ID}/estimates`,
      { message: 'Estimate unavailable' },
      500,
    );
    await mockJson(page, '/api/workshop/orders', createMockListResponse([]));

    await page.goto(`/workshop/orders/${WORKSHOP_ORDER_ID}`);

    await expect(breadcrumbTrail(page).getByText('WO-2026-0901')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoCriticalA11yViolations(page);
    await expectNoHeadingOrderViolations(page);

    await breadcrumbTrail(page).getByRole('link', { name: 'Workshop Orders' }).click();

    await expect(page).toHaveURL('/workshop/orders');
    await expect(breadcrumbTrail(page)).toHaveCount(0);
  });
});
