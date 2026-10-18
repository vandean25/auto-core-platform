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
  createMockVehicleStockRow,
} from './utils/mock-factories';
import { DE_CUSTOMERS } from './helpers/de-customers';
import { DE_SALES } from './helpers/de-sales';
import { DE_VEHICLES } from './helpers/de-vehicles';
import { DE_VEHICLE_STOCK } from './helpers/de-vehicle-stock';
import { DE_FINANCE } from './helpers/de-finance';
import { DE_INVENTORY } from './helpers/de-inventory';
import { waitForDeNamespace } from './helpers/wait-for-i18n';

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
    name: DE_INVENTORY.partsList.title,
    path: '/inventory',
    entity: 'Artikel',
    seed: 'TEST-SKU-1',
    mockFactory: () => createMockInventoryItem({ sku: 'TEST-SKU-1', name: 'Oil Filter' }),
    apiPath: '/api/inventory',
    // InventoryList also calls /api/brands for the brand filter dropdown
    secondaryApiMocks: ['/api/brands', '/api/inventory/locations'],
  },
  {
    name: DE_FINANCE.vendors.list.title,
    path: '/vendors',
    entity: DE_FINANCE.vendors.list.create,
    seed: 'Bosch Automotive',
    mockFactory: () => createMockVendor({ name: 'Bosch Automotive' }),
    apiPath: '/api/vendors',
  },
  {
    name: DE_CUSTOMERS.list.title,
    path: '/customers',
    entity: DE_CUSTOMERS.list.addCustomer,
    seed: 'John',
    mockFactory: () => createMockCustomer({ first_name: 'John', last_name: 'Doe' }),
    apiPath: '/api/customers',
  },
  {
    name: DE_FINANCE.purchaseOrders.list.title,
    path: '/purchase-orders',
    entity: DE_FINANCE.purchaseOrders.list.create,
    seed: 'PO-2026-0001',
    mockFactory: () => createMockPurchaseOrder({ order_number: 'PO-2026-0001' }),
    apiPath: '/api/purchase-orders',
  },
  {
    name: DE_SALES.orders.list.title,
    path: '/sales-orders',
    entity: DE_SALES.orders.list.newOrder,
    seed: 'SO-2026-0001',
    mockFactory: () => createMockSalesOrder({ order_number: 'SO-2026-0001' }),
    apiPath: '/api/sales-orders',
  },
  {
    name: DE_FINANCE.purchaseBills.list.title,
    path: '/purchase-bills',
    entity: DE_FINANCE.purchaseBills.list.create,
    seed: 'B-2026-001',
    mockFactory: () => createMockPurchaseBill({ vendor_invoice_number: 'B-2026-001' }),
    apiPath: '/api/purchase-invoices',
  },
  {
    name: DE_VEHICLES.list.title,
    path: '/vehicles',
    entity: DE_VEHICLES.list.addVehicle,
    seed: 'Toyota Corolla',
    mockFactory: () => createMockVehicleListItem({ make: 'Toyota', model: 'Corolla' }),
    apiPath: '/api/vehicles',
  },
  {
    name: DE_VEHICLE_STOCK.stockList.title,
    path: '/vehicle-stock',
    entity: DE_VEHICLE_STOCK.stockList.addVehicle,
    seed: 'Volkswagen Golf',
    mockFactory: () => createMockVehicleStockRow(),
    apiPath: '/api/vehicle-stock',
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
          const body =
            secondaryPath === '/api/inventory/locations'
              ? JSON.stringify([])
              : JSON.stringify(createMockListResponse([]));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body,
          });
        });
      }

      // ── Step 2: Navigate and wait for network idle ──────────────────────────
      await corePage.navigate(module.path);
      if (module.path === '/inventory') {
        await waitForDeNamespace(page, 'inventory');
      }

      // ── Step 3: Golden Rule 1 — Header Consistency ─────────────────────────
      await corePage.verifyHeaderConsistency(module.name);

      // ── Step 4: Golden Rule 3 — Row click opens detail view or navigates ───
      await corePage.openRowDetails(module.seed);
    });
  }
});
