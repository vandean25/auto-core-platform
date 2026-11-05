import { expect, test, type Page } from '@playwright/test';
import { AutoCorePage } from '../pom/AutoCorePage';
import { DE_COMMON } from '../helpers/de-common';
import { DE_SHELL } from '../helpers/de-shell';
import { expectVisualMatch, prepareVisualPage } from '../helpers/visual';
import { A11Y_SMOKE_ROUTES, type A11ySmokeRoute } from '../utils/a11y-smoke-routes';
import {
  createMockCustomer,
  createMockInventoryItem,
  createMockListResponse,
  createMockSalesOrder,
  createMockVehicleListItem,
} from '../utils/mock-factories';

/**
 * AUT-657: one screenshot per core page (the login page is in its own describe because it needs the dev server).
 * Pages that the a11y smoke suite already mocks reuse those mocks, so both suites see the same data.
 */

type VisualPage = Pick<A11ySmokeRoute, 'path' | 'mock' | 'ready'> & {
  name: string;
  /** Waits for a state that settles on its own, so the shot never catches it half way. */
  settle?: (page: Page) => Promise<void>;
};

/** The a11y route's mocks, plus empty `{ data: [] }` answers for the cards that would otherwise show a load error. */
function a11yRoute(name: string, emptyPaths: string[] = []): VisualPage {
  const route = A11Y_SMOKE_ROUTES.find((candidate) => candidate.name === name);
  if (!route) throw new Error(`No a11y smoke route named "${name}"`);
  return {
    ...route,
    name: name.replace(/\W+/g, '-'),
    mock: async (page) => {
      await route.mock(page);
      for (const path of emptyPaths) await mockJson(page, path, { data: [] });
    },
  };
}

async function mockJson(page: Page, path: string, body: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(path), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

const widgets = [
  {
    id: 'widget-list-1',
    name: 'Lagerartikel',
    sourceKey: 'inventory',
    sourceLabel: 'Lager',
    href: '/inventory?search=',
    displayType: 'list',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'widget-metric-1',
    name: 'Auftragswert',
    sourceKey: 'sales-orders',
    sourceLabel: 'Kundenaufträge',
    href: '/sales-orders?search=',
    displayType: 'metric',
    metricCalculation: 'sum',
    metricField: 'total_amount',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

const vehicle = {
  ...createMockVehicleListItem({ id: 'veh-visual-1', year: 2020, make: 'Skoda', model: 'Octavia', plate: 'W-4711X' }),
  sales_orders: [],
  workshop_orders: [],
  invoices: [],
  customer: createMockCustomer({ first_name: 'Jane', last_name: 'Smith' }),
};

const PAGES: VisualPage[] = [
  {
    name: 'dashboard',
    path: '/dashboard',
    mock: async (page) => {
      await page.addInitScript(
        (value) => window.localStorage.setItem('acp:dashboard-widgets:e2e-test-user', value),
        JSON.stringify(widgets),
      );
      await mockJson(
        page,
        '/api/inventory',
        createMockListResponse([
          createMockInventoryItem({ id: '1', sku: 'BRK-001', name: 'Bremsbeläge', brand: 'Bosch', status: 'ACTIVE' }),
          createMockInventoryItem({ id: '2', sku: 'OIL-005', name: 'Motoröl 5W-30', brand: 'Castrol', status: 'ACTIVE' }),
        ]),
      );
      await mockJson(
        page,
        '/api/sales-orders',
        createMockListResponse([
          createMockSalesOrder({ id: 'so-1', order_number: 'SO-2026-0001', total_amount: '1250.00' }),
          createMockSalesOrder({ id: 'so-2', order_number: 'SO-2026-0002', total_amount: '750.00' }),
        ]),
      );
    },
    ready: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: DE_COMMON.dashboard.title })).toBeVisible();
      await expect(page.getByText('BRK-001')).toBeVisible();
    },
  },
  {
    name: 'customers',
    path: '/customers',
    mock: async (page) => {
      await mockJson(
        page,
        '/api/customers',
        createMockListResponse([
          createMockCustomer({ id: 'c-1', first_name: 'Jane', last_name: 'Smith', email: 'jane.smith@example.com' }),
          createMockCustomer({ id: 'c-2', first_name: 'Max', last_name: 'Mustermann', email: 'max@example.com' }),
          createMockCustomer({
            id: 'c-3',
            type: 'COMPANY',
            company_name: 'Acme Motors GmbH',
            first_name: null,
            last_name: null,
            email: 'office@acme.example',
          }),
        ]),
      );
    },
    ready: async (page) => {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('Acme Motors GmbH')).toBeVisible();
    },
  },
  a11yRoute('customer detail'),
  {
    ...a11yRoute('workshop order detail', [
      '/api/workshop/orders/ws-a11y-1/estimates',
      '/api/workshop/orders/ws-a11y-1/communications',
      '/api/workshop-orders/ws-a11y-1/tyre-measurements',
      '/api/workshop-orders/ws-a11y-1/measurements?limit=50&page=1',
      '/api/workshop-orders/inspection-device-sources',
      '/api/tyre-sets/by-vehicle/veh-123',
    ]),
    // The vehicle banner shows a skeleton until its unmocked request fails (404, one retry after 1s); the shot waits for the end state.
    settle: async (page) => {
      await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 });
    },
  },
  {
    name: 'vehicle-detail',
    path: `/vehicles/${vehicle.id}`,
    mock: async (page) => {
      await mockJson(page, `/api/vehicles/${vehicle.id}`, vehicle);
      await mockJson(page, `/api/vehicles/${vehicle.id}/parties`, { data: [], suggested_bill_to: null });
      await mockJson(page, `/api/vehicles/${vehicle.id}/pickerl-open-order`, null);
      await mockJson(page, `/api/vehicles/${vehicle.id}/inspection-records`, []);
      await mockJson(page, `/api/tyre-sets/by-vehicle/${vehicle.id}`, { data: [] });
    },
    ready: async (page) => {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    },
  },
  a11yRoute('inventory list'),
  a11yRoute('settings: finance tab'),
];

test.describe('core pages', () => {
  for (const visualPage of PAGES) {
    test(visualPage.name, async ({ page }) => {
      await prepareVisualPage(page);
      await visualPage.mock(page);
      await new AutoCorePage(page, visualPage.name).navigate(visualPage.path);
      await visualPage.ready(page);
      await visualPage.settle?.(page);
      await expectVisualMatch(page, visualPage.name);
    });
  }
});

/** AUT-659: the same pages in the dark theme (system default, so the emulated colour scheme switches it). */
const DARK_PAGE_NAMES = ['dashboard', 'customer-detail', 'workshop-order-detail', 'inventory-list'];

test.describe('core pages (dark)', () => {
  test.use({ colorScheme: 'dark' });

  for (const visualPage of PAGES.filter((candidate) => DARK_PAGE_NAMES.includes(candidate.name))) {
    test(`${visualPage.name}-dark`, async ({ page }) => {
      await prepareVisualPage(page);
      await visualPage.mock(page);
      await new AutoCorePage(page, visualPage.name).navigate(visualPage.path);
      await visualPage.ready(page);
      await visualPage.settle?.(page);
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      await expectVisualMatch(page, `${visualPage.name}-dark`);
    });
  }
});

test.describe('login page', () => {
  // The e2e bundle skips auth at build time; only the dev server (port 5175) can show the form.
  test.use({ baseURL: 'http://localhost:5175' });

  test('login', async ({ page }) => {
    await prepareVisualPage(page);
    // Same trick as login.spec.ts: patch the two flags that make the app skip the sign-in form.
    await page.route(/\/src\/lib\/(firebase|runtime-flags)\.ts/, async (route) => {
      const response = await route.fetch();
      const source = (await response.text())
        .replace('export const firebaseConfigMissing = !hasFirebaseConfig', 'export const firebaseConfigMissing = false')
        .replace(/import\.meta\.env\.VITE_E2E_SKIP_AUTH === ["']true["']/, 'false');
      await route.fulfill({ response, body: source });
    });
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());

    await page.goto('/login');
    await expect(page.getByLabel(DE_SHELL.login.email)).toBeVisible();
    await expectVisualMatch(page, 'login');
  });
});

