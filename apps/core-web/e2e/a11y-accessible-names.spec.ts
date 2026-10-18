import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockBrand,
  createMockFinanceSettings,
  createMockListResponse,
  createMockRevenueGroup,
} from './utils/mock-factories';
import { DE_SALES } from './helpers/de-sales';
import { DE_SETTINGS } from './helpers/de-settings';
import { waitForDeNamespace } from './helpers/wait-for-i18n';

/**
 * AUT-471: icon-only buttons and links must expose an accessible name.
 * Scoped to the naming rules so this check stays independent of other a11y backlog items.
 */
const NAMING_RULES = ['button-name', 'link-name'];

async function expectNamedControls(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(NAMING_RULES).analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.html),
    })),
  ).toEqual([]);
}

const salesOrder = {
  id: 'so-1',
  order_number: 'SO-2026-0001',
  status: 'DRAFT',
  createdAt: '2026-09-21T00:00:00.000Z',
  notes: null,
  customer: {
    id: 'cust-1',
    type: 'PRIVATE',
    first_name: 'Test',
    last_name: 'Customer',
    email: 'test@example.com',
    phone: null,
    address_street: 'Main',
    address_zip: '1010',
    address_city: 'Wien',
    address_country: 'AT',
  },
  items: [],
};

test.describe('Icon-only controls have accessible names (AUT-471)', () => {
  test('sales order detail back link is named and naming rules pass', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/sales-orders/so-1'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(salesOrder),
      });
    });

    const corePage = new AutoCorePage(page, 'Sales Order');
    await corePage.navigate('/sales-orders/so-1');
    await waitForDeNamespace(page, 'sales');

    await expect(page.getByRole('link', { name: DE_SALES.orders.detail.backAria })).toBeVisible({
      timeout: 30_000,
    });
    await expectNamedControls(page);
  });

  test('settings brands row actions are named and naming rules pass', async ({ page }) => {
    const mockBrand = createMockBrand({ name: 'Acme' });

    // The settings page gates its content on finance settings, so mock the same boundaries settings.spec.ts does.
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockFinanceSettings()),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([createMockRevenueGroup({ name: 'Parts Revenue' })]),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockBrand])),
      });
    });

    const corePage = new AutoCorePage(page, 'Settings');
    await corePage.navigate('/settings?tab=brands');

    await expect(
      page.getByRole('button', {
        name: DE_SETTINGS.brands.table.editAria.replace('{{name}}', 'Acme'),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: DE_SETTINGS.brands.table.deleteAria.replace('{{name}}', 'Acme'),
      }),
    ).toBeVisible();
    await expectNamedControls(page);
  });
});
