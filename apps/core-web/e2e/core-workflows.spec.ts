import { test } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockInventoryItem,
  createMockCustomer,
  createMockVendor,
  createMockPurchaseOrder,
  createMockSalesOrder,
  createMockPurchaseBill,
  createMockListResponse,
  createMockVehicleListItem,
} from './utils/mock-factories';

/**
 * Blueprint Validation Suite — Core Management Workflows
 *
 * Each test validates the three Golden Rules for a list page:
 *   1. Header Structure: correct h1 title + visible create button in the top-right.
 *   2. Data-attribute rows: rows carry `data-table-row="true"` (enforced by DataTable).
 *   3. Row Interaction: clicking a row opens a detail Sheet/Dialog OR navigates to a detail URL.
 *
 * All API calls are mocked (regex-safe) so tests are deterministic and do not depend
 * on database seed state.
 */

interface ModuleConfig {
  /** Label shown in the page `<h1>` element. */
  name: string;
  /** Frontend route, e.g. `/vendors`. */
  path: string;
  /** Entity name used by the create button (matched via regex in AutoCorePage). */
  entity: string;
  /** Text present in the first mocked row — used for row-click verification. */
  seed: string;
  /** Factory that produces a single mocked list item. */
  mockFactory: () => Record<string, unknown>;
  /** Backend API path for the list endpoint (used to build the regex route matcher). */
  apiPath: string;
  /**
   * Additional API paths that the page calls on mount (e.g. filter dropdowns).
   * These are mocked with an empty success payload so the test is fully network-isolated
   * even when the primary list endpoint is already mocked.
   */
  secondaryApiMocks?: string[];
}

const modules: ModuleConfig[] = [
  {
    name: 'Inventory',
    path: '/inventory',
    entity: 'Item',
    seed: 'TEST-SKU-1',
    mockFactory: () => createMockInventoryItem({ sku: 'TEST-SKU-1', name: 'Oil Filter' }),
    apiPath: '/api/inventory',
    // InventoryList also calls /api/brands for the brand filter dropdown
    secondaryApiMocks: ['/api/brands'],
  },
  {
    name: 'Vendors',
    path: '/vendors',
    entity: 'Vendor',
    seed: 'Bosch Automotive',
    mockFactory: () => createMockVendor({ name: 'Bosch Automotive' }),
    apiPath: '/api/vendors',
  },
  {
    name: 'Customers',
    path: '/customers',
    entity: 'Customer',
    seed: 'John',
    mockFactory: () => createMockCustomer({ first_name: 'John', last_name: 'Doe' }),
    apiPath: '/api/customers',
  },
  {
    name: 'Purchase Orders',
    path: '/purchase-orders',
    entity: 'Purchase Order',
    seed: 'PO-2026-0001',
    mockFactory: () => createMockPurchaseOrder({ order_number: 'PO-2026-0001' }),
    apiPath: '/api/purchase-orders',
  },
  {
    name: 'Sales Orders',
    path: '/sales-orders',
    entity: 'Order',
    seed: 'SO-2026-0001',
    mockFactory: () => createMockSalesOrder({ order_number: 'SO-2026-0001' }),
    apiPath: '/api/sales-orders',
  },
  {
    name: 'Purchase Bills',
    path: '/purchase-bills',
    entity: 'Bill',
    seed: 'B-2026-001',
    mockFactory: () => createMockPurchaseBill({ vendor_invoice_number: 'B-2026-001' }),
    apiPath: '/api/purchase-invoices',
  },
  {
    name: 'Vehicles',
    path: '/vehicles',
    entity: 'Vehicle',
    seed: 'Toyota Corolla',
    mockFactory: () => createMockVehicleListItem({ make: 'Toyota', model: 'Corolla' }),
    apiPath: '/api/vehicles',
  },
];

test.describe('Blueprint: Golden Rules — Core List Pages', () => {
  for (const module of modules) {
    test(`[${module.name}] header structure, data-table rows, and row-to-detail flow`, async ({
      page,
    }) => {
      const corePage = new AutoCorePage(page, module.entity);

      // ── Step 1: Mock primary API before navigating (network isolation) ────────
      await page.route(AutoCorePage.apiRouteMatcher(module.apiPath), async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockListResponse([module.mockFactory()])),
        });
      });

      // ── Step 1b: Mock secondary APIs with empty payloads ──────────────────────
      // Prevents unmocked background requests from adding flakiness when the
      // backend is not available (e.g. brand filter dropdowns on Inventory).
      for (const secondaryPath of module.secondaryApiMocks ?? []) {
        await page.route(AutoCorePage.apiRouteMatcher(secondaryPath), async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockListResponse([])),
          });
        });
      }

      // ── Step 2: Navigate and wait for network idle ──────────────────────────
      await corePage.navigate(module.path);

      // ── Step 3: Golden Rule 1 — Header Consistency ─────────────────────────
      await corePage.verifyHeaderConsistency(module.name);

      // ── Step 4: Golden Rule 3 — Row click opens detail view or navigates ───
      await corePage.openRowDetails(module.seed);
    });
  }
});
