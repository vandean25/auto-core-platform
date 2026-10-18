import { expect, type Page } from '@playwright/test';
import { AutoCorePage } from '../pom/AutoCorePage';
import { DE_SETTINGS } from '../helpers/de-settings';
import inventoryDe from '../../../../locales/de/inventory.json' with { type: 'json' };
import {
  createMockBay,
  createMockBrand,
  createMockCustomerDetailResponse,
  createMockEmployee,
  createMockFinanceSettings,
  createMockInventoryItem,
  createMockLaborCategory,
  createMockLaborOperation,
  createMockListResponse,
  createMockPurchaseOrder,
  createMockRevenueGroup,
  createMockSalesOrder,
  createMockStorageLocation,
  createMockVendor,
  createMockWorkshopOrder,
} from './mock-factories';

/**
 * AUT-482: the routes the shared a11y smoke spec scans. Each entry mocks the API calls its page
 * needs, so the scan runs on rendered content and not on an error state.
 */
export interface A11ySmokeRoute {
  name: string;
  path: string;
  /** Also checked at 200% zoom (the three key pages). */
  keyPage?: boolean;
  /** Registers the API mocks before navigation. */
  mock: (page: Page) => Promise<void>;
  /** Runs after the page loads, before `ready` (opens the dialog under test). */
  open?: (page: Page) => Promise<void>;
  /** Waits until the page, or the dialog it opens, has rendered. */
  ready: (page: Page) => Promise<void>;
}

async function mockApi(page: Page, path: string | RegExp, body: unknown, status = 200) {
  const matcher = typeof path === 'string' ? AutoCorePage.apiRouteMatcher(path) : path;
  await page.route(matcher, async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/** Layout shell calls these on most pages; mock them so smoke tests stay offline. */
async function mockShellApis(page: Page) {
  await mockApi(page, '/api/me/sites', []);
}

/**
 * The page has rendered once its title (`h1`) is visible; pass the title to pin it. The match is
 * not exact because a detail title can carry a status badge (`SO-2026-0901Draft`).
 */
function titleReady(title?: string) {
  return async (page: Page) => {
    await expect(page.getByRole('heading', { level: 1, ...(title ? { name: title } : {}) })).toBeVisible();
  };
}

const SALES_ORDER_ID = 'so-a11y-1';
const CUSTOMER_ID = 'cust-a11y-1';
const WORKSHOP_ORDER_ID = 'ws-a11y-1';
const PURCHASE_ORDER_ID = 'po-a11y-1';
const VENDOR_ID = 'vendor-a11y-1';

const boardMechanic = createMockEmployee({
  id: 'emp-mech-001',
  name: 'Alex Novak',
  role: 'MECHANIC',
  isActive: true,
  sortOrder: 1,
});

const boardBay = createMockBay({
  id: 'bay-001',
  name: 'Bay 01',
  isActive: true,
  sortOrder: 1,
});

const boardOrders = [
  {
    id: 'ws-board-001',
    orderNumber: 'WO-2026-0001',
    status: 'INTAKE',
    customer: { id: 'cust-1', type: 'PRIVATE', firstName: 'John', lastName: 'Doe', companyName: null },
    vehicle: { id: 'veh-1', make: 'Skoda', model: 'Octavia', year: 2020, plate: 'SK-2020-OCT' },
    mechanicId: boardMechanic.id,
    bayId: null,
    stagingLocationId: null,
    partsStatus: 'READY',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'ws-board-002',
    orderNumber: 'WO-2026-0002',
    status: 'SCHEDULED',
    customer: { id: 'cust-2', type: 'PRIVATE', firstName: 'Maria', lastName: 'Müller', companyName: null },
    vehicle: { id: 'veh-2', make: 'VW', model: 'Golf', year: 2022, plate: 'VW-2022-GLF' },
    mechanicId: null,
    bayId: null,
    stagingLocationId: null,
    partsStatus: 'NO_PARTS',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const A11Y_SMOKE_ROUTES: A11ySmokeRoute[] = [
  {
    name: 'sales order detail',
    path: `/sales-orders/${SALES_ORDER_ID}`,
    keyPage: true,
    mock: async (page) => {
      await mockApi(page, `/api/sales-orders/${SALES_ORDER_ID}`, {
        ...createMockSalesOrder({ id: SALES_ORDER_ID, order_number: 'SO-2026-0901' }),
        items: [],
        notes: null,
      });
    },
    ready: titleReady('SO-2026-0901'),
  },
  {
    name: 'customer detail',
    path: `/customers/${CUSTOMER_ID}`,
    keyPage: true,
    mock: async (page) => {
      await mockApi(
        page,
        `/api/customers/${CUSTOMER_ID}`,
        createMockCustomerDetailResponse({ id: CUSTOMER_ID, first_name: 'Jane', last_name: 'Smith' }),
      );
      await mockApi(page, `/api/customers/${CUSTOMER_ID}/communication-preferences`, {
        customer_id: CUSTOMER_ID,
        controller_legal_entity_id: 'ctrl-1',
        controller_legal_entity_name: 'Demo Workshop GmbH',
        revision: 0,
        processing_status: 'ACTIVE',
        preferences: [],
      });
      await mockApi(page, `/api/customers/${CUSTOMER_ID}/communication-history`, {
        data: [],
        meta: { total: 0, page: 1, pageSize: 25, pageCount: 1 },
      });
      await mockApi(page, /\/api\/tyre-sets\/by-customer\/.*/, []);
    },
    ready: titleReady('Jane Smith'),
  },
  {
    name: 'workshop order detail',
    path: `/workshop/orders/${WORKSHOP_ORDER_ID}`,
    keyPage: true,
    mock: async (page) => {
      await mockApi(
        page,
        `/api/workshop/orders/${WORKSHOP_ORDER_ID}`,
        createMockWorkshopOrder({ id: WORKSHOP_ORDER_ID, order_number: 'WO-2026-0901' }),
      );
      // The estimate load fails on purpose, so its unavailable alert is part of the page.
      await mockApi(
        page,
        `/api/workshop/orders/${WORKSHOP_ORDER_ID}/estimates`,
        { message: 'Estimate unavailable' },
        500,
      );
    },
    ready: titleReady('WO-2026-0901'),
  },
  {
    name: 'purchase order detail',
    path: `/purchase-orders/${PURCHASE_ORDER_ID}`,
    mock: async (page) => {
      const vendor = createMockVendor({ id: VENDOR_ID, name: 'Bosch Automotive' });
      await mockApi(
        page,
        `/api/purchase-orders/${PURCHASE_ORDER_ID}`,
        createMockPurchaseOrder({
          id: PURCHASE_ORDER_ID,
          order_number: 'PO-2026-0901',
          status: 'DRAFT',
          vendor_id: VENDOR_ID,
          vendor,
          items: [],
        }),
      );
      await mockApi(page, '/api/vendors', createMockListResponse([vendor]));
      await mockApi(page, `/api/vendors/${VENDOR_ID}/unbilled-receipts`, []);
      await mockApi(page, '/api/inventory', createMockListResponse([createMockInventoryItem()]));
    },
    ready: titleReady('PO-2026-0901'),
  },
  {
    name: 'workshop board',
    path: '/workshop/board',
    mock: async (page) => {
      await mockApi(page, '/api/workshop/resources', {
        mechanics: [boardMechanic],
        bays: [boardBay],
      });
      await mockApi(page, '/api/workshop/board/active', { data: boardOrders });
    },
    ready: async (page) => {
      await expect(page.getByTestId('board-column-unassigned')).toBeVisible();
    },
  },
  {
    name: 'settings: finance tab',
    path: '/settings',
    mock: async (page) => {
      await mockApi(page, '/api/finance/settings', createMockFinanceSettings());
      await mockApi(page, '/api/finance/revenue-groups', [
        createMockRevenueGroup({ name: 'Parts Revenue' }),
      ]);
    },
    ready: titleReady(DE_SETTINGS.page.title),
  },
  {
    name: 'settings: brands tab',
    path: '/settings?tab=brands',
    mock: async (page) => {
      await mockShellApis(page);
      await mockApi(page, '/api/finance/settings', createMockFinanceSettings());
      await mockApi(page, '/api/finance/revenue-groups', []);
      await mockApi(page, '/api/brands', createMockListResponse([createMockBrand({ name: 'Stellantis' })]));
    },
    ready: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.page.title })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'settings: storage locations tab',
    path: '/settings?tab=locations',
    mock: async (page) => {
      await mockApi(page, '/api/finance/settings', createMockFinanceSettings());
      await mockApi(page, '/api/inventory/locations/tree', [createMockStorageLocation({ name: 'Aisle F' })]);
    },
    ready: titleReady(DE_SETTINGS.page.title),
  },
  {
    name: 'settings: labor tab',
    path: '/settings?tab=labor',
    mock: async (page) => {
      await mockApi(page, '/api/finance/settings', createMockFinanceSettings());
      await mockApi(
        page,
        '/api/labor/categories',
        createMockListResponse([createMockLaborCategory({ name: 'Diagnostic Labor' })]),
      );
      await mockApi(
        page,
        '/api/labor/operations',
        createMockListResponse([createMockLaborOperation({ description: 'Engine Diagnostics' })]),
      );
    },
    ready: titleReady(DE_SETTINGS.page.title),
  },
  {
    name: 'customers list with add customer dialog open',
    path: '/customers',
    mock: async (page) => {
      await mockApi(page, '/api/customers', createMockListResponse([]));
    },
    open: async (page) => {
      const { DE_CUSTOMERS } = await import('../helpers/de-customers');
      await new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer).createButton.click();
    },
    ready: async (page) => {
      const { DE_CUSTOMERS } = await import('../helpers/de-customers');
      await expect(page.getByRole('dialog', { name: DE_CUSTOMERS.dialog.addTitle })).toBeVisible();
    },
  },
  {
    name: 'sales orders list',
    path: '/sales-orders',
    mock: async (page) => {
      await mockApi(page, '/api/sales-orders', createMockListResponse([]));
    },
    ready: titleReady(),
  },
  {
    name: 'purchase orders list',
    path: '/purchase-orders',
    mock: async (page) => {
      await mockApi(page, '/api/purchase-orders', createMockListResponse([]));
    },
    ready: titleReady(),
  },
  {
    name: 'inventory list',
    path: '/inventory',
    mock: async (page) => {
      await mockShellApis(page);
      await mockApi(page, '/api/inventory', createMockListResponse([createMockInventoryItem()]));
      await mockApi(page, '/api/brands', createMockListResponse([]));
      await mockApi(page, '/api/inventory/locations', []);
    },
    ready: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: inventoryDe.partsList.title }),
      ).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: 'vehicle stock list',
    path: '/vehicle-stock',
    mock: async (page) => {
      await mockApi(page, '/api/vehicle-stock', createMockListResponse([]));
    },
    ready: titleReady(),
  },
  {
    name: 'vendors list',
    path: '/vendors',
    mock: async (page) => {
      await mockApi(page, '/api/vendors', createMockListResponse([]));
    },
    ready: titleReady(),
  },
];
