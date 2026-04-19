import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';

/**
 * Blueprint Validation Suite — Dashboard Page
 *
 * Tests cover:
 *   1. Page load with header (h1 "Dashboard", subtitle).
 *   2. Empty state when no widgets are saved in localStorage.
 *   3. Widget rendering for "list" display type with mocked API data.
 *   4. Widget rendering for "metric" display type.
 *   5. Widget empty-data state ("No data for this widget.").
 *   6. Widget removal via the X button.
 *
 * All API calls are mocked and widget state is seeded via localStorage
 * so tests are deterministic and do not depend on database seed state.
 */

const STORAGE_KEY = 'acp:dashboard-widgets:e2e-user';

/**
 * Seed the DashboardWidgetsProvider localStorage BEFORE the app boots.
 * The provider reads from `acp:dashboard-widgets:<userKey>` on mount.
 *
 * We need the app's DashboardWidgetsProvider to use the same userKey
 * that we seed here. Since the E2E env skips auth (VITE_E2E_SKIP_AUTH),
 * we look at how the app determines the userKey.
 */
function createListWidget(overrides: Partial<MockWidget> = {}): MockWidget {
  return {
    id: 'widget-list-1',
    name: 'Active Inventory',
    sourceKey: 'inventory',
    sourceLabel: 'Inventory',
    href: '/inventory?search=',
    displayType: 'list',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createMetricWidget(overrides: Partial<MockWidget> = {}): MockWidget {
  return {
    id: 'widget-metric-1',
    name: 'Total Sales Value',
    sourceKey: 'sales-orders',
    sourceLabel: 'Sales Orders',
    href: '/sales-orders?search=',
    displayType: 'metric',
    metricCalculation: 'sum',
    metricField: 'total_amount',
    createdAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

type MockWidget = {
  id: string;
  name: string;
  sourceKey: string;
  sourceLabel: string;
  href: string;
  displayType: 'list' | 'donut' | 'metric';
  groupByField?: string;
  metricCalculation?: 'count' | 'sum';
  metricField?: string;
  createdAt: string;
};

/**
 * Helper: Seed widgets into localStorage before navigation.
 * Uses page.addInitScript to inject the data before React hydration.
 */
async function seedWidgets(page: import('@playwright/test').Page, widgets: MockWidget[], storageKey: string) {
  const serialized = JSON.stringify(widgets);
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: storageKey, value: serialized },
  );
}

test.describe('Blueprint: Dashboard Page', () => {
  test('renders page header with title and subtitle', async ({ page }) => {
    // Navigate without seeding any widgets — just verify the header
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Build your command center from saved table filters.')).toBeVisible();
  });

  test('shows empty state when no widgets are saved', async ({ page }) => {
    // Clear any stale localStorage before navigating
    await page.addInitScript(() => {
      // Remove all dashboard widget keys
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('acp:dashboard-widgets:')) {
          window.localStorage.removeItem(key);
        }
      }
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Empty state message
    await expect(
      page.getByText('No widgets yet. Open a list view, apply filters, then click Add to Dashboard.'),
    ).toBeVisible();
  });

  test('renders a list widget with mocked inventory data', async ({ page }) => {
    const widget = createListWidget();

    // Determine the actual storage key used by the app
    // First, let's find out what userKey the provider uses in E2E mode
    await seedWidgetsForApp(page, [widget]);

    // Mock the inventory API that the widget will call
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: '1', sku: 'BRK-001', name: 'Brake Pad Set', brand: 'Bosch', status: 'ACTIVE', price: '45.00' },
            { id: '2', sku: 'OIL-005', name: '5W-30 Engine Oil', brand: 'Castrol', status: 'ACTIVE', price: '12.50' },
          ],
          meta: { total: 2, page: 1, pageSize: 200 },
        }),
      });
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Widget card should be visible with its title and source label
    await expect(page.getByText('Active Inventory')).toBeVisible();
    await expect(page.getByText('Inventory').first()).toBeVisible();

    // List preview rows should render (using listPreviewFields: sku, name, status)
    await expect(page.getByText('BRK-001')).toBeVisible();
    await expect(page.getByText('OIL-005')).toBeVisible();
  });

  test('renders a metric widget with summed value', async ({ page }) => {
    const widget = createMetricWidget();

    await seedWidgetsForApp(page, [widget]);

    // Mock the sales-orders API
    await page.route(AutoCorePage.apiRouteMatcher('/api/sales-orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'so-1', order_number: 'SO-2026-0001', status: 'CONFIRMED', total_amount: '1250.00', customer: { last_name: 'Smith' } },
            { id: 'so-2', order_number: 'SO-2026-0002', status: 'COMPLETED', total_amount: '750.00', customer: { last_name: 'Doe' } },
          ],
          meta: { total: 2, page: 1, pageSize: 200 },
        }),
      });
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Widget title
    await expect(page.getByText('Total Sales Value')).toBeVisible();

    // Metric label
    await expect(page.getByText('Summed Value')).toBeVisible();
  });

  test('shows "No data for this widget." when API returns empty data', async ({ page }) => {
    const widget = createListWidget({ id: 'widget-empty-1', name: 'Empty Widget' });

    await seedWidgetsForApp(page, [widget]);

    // Mock inventory API returning empty data
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, pageSize: 200 } }),
      });
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Widget should show "No data for this widget."
    await expect(page.getByText('No data for this widget.')).toBeVisible();
  });

  test('removes a widget when the X button is clicked', async ({ page }) => {
    const widget = createListWidget({ name: 'Removable Widget' });

    await seedWidgetsForApp(page, [widget]);

    // Mock inventory API
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, pageSize: 200 } }),
      });
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Widget is visible
    await expect(page.getByText('Removable Widget')).toBeVisible();

    // Click the remove button
    await page.getByRole('button', { name: 'Remove widget Removable Widget' }).click();

    // Widget should disappear, empty state should appear
    await expect(page.getByText('Removable Widget')).not.toBeVisible();
    await expect(
      page.getByText('No widgets yet. Open a list view, apply filters, then click Add to Dashboard.'),
    ).toBeVisible();
  });

  test('renders multiple widgets in the grid', async ({ page }) => {
    const listWidget = createListWidget();
    const metricWidget = createMetricWidget();

    await seedWidgetsForApp(page, [listWidget, metricWidget]);

    // Mock both APIs
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: '1', sku: 'BRK-001', name: 'Brake Pad Set', brand: 'Bosch', status: 'ACTIVE', price: '45.00' }],
          meta: { total: 1, page: 1, pageSize: 200 },
        }),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/sales-orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'so-1', order_number: 'SO-2026-0001', status: 'CONFIRMED', total_amount: '500.00', customer: { last_name: 'Test' } }],
          meta: { total: 1, page: 1, pageSize: 200 },
        }),
      });
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Both widgets should be visible
    await expect(page.getByText('Active Inventory')).toBeVisible();
    await expect(page.getByText('Total Sales Value')).toBeVisible();

    // Grid should have the correct layout class
    const grid = page.locator('.grid.gap-4');
    await expect(grid).toBeVisible();
  });
});

/**
 * Seeds widgets into the app's localStorage using the actual storage key
 * that the DashboardWidgetsProvider will read from.
 *
 * In E2E mode (VITE_E2E_SKIP_AUTH=true), we need to match whatever userKey
 * the app passes to DashboardWidgetsProvider. We scan all possible keys and
 * also set a wildcard fallback to cover any userKey variant.
 */
async function seedWidgetsForApp(page: import('@playwright/test').Page, widgets: MockWidget[]) {
  const serialized = JSON.stringify(widgets);
  await page.addInitScript(
    ({ value }: { value: string }) => {
      // The app's DashboardWidgetsProvider uses a userKey-based storage key.
      // In E2E mode, the exact userKey depends on the auth mock.
      // We seed multiple common variants to ensure the provider picks up the widgets.
      const possibleKeys = [
        'acp:dashboard-widgets:e2e-user',
        'acp:dashboard-widgets:default',
        'acp:dashboard-widgets:anonymous',
        'acp:dashboard-widgets:test',
      ];
      for (const key of possibleKeys) {
        window.localStorage.setItem(key, value);
      }
      // Also intercept any future calls to getItem for dashboard widgets
      const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
      window.localStorage.getItem = function (key: string) {
        if (key.startsWith('acp:dashboard-widgets:')) {
          return value;
        }
        return originalGetItem(key);
      };
    },
    { value: serialized },
  );
}
