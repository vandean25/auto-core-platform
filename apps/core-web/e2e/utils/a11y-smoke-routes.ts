import { expect, type Page } from '@playwright/test';
import { AutoCorePage } from '../pom/AutoCorePage';
import { DE_SETTINGS } from '../helpers/de-settings';
import { A11Y_SMOKE_IDS, A11Y_SMOKE_PATHS_BY_NAME } from './a11y-smoke-route-paths';
import inventoryDe from '../../../../locales/de/inventory.json' with { type: 'json' };
import financeDe from '../../../../locales/de/finance.json' with { type: 'json' };
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

const SALES_ORDER_ID = A11Y_SMOKE_IDS.salesOrder;
const CUSTOMER_ID = A11Y_SMOKE_IDS.customer;
const WORKSHOP_ORDER_ID = A11Y_SMOKE_IDS.workshopOrder;
const PURCHASE_ORDER_ID = A11Y_SMOKE_IDS.purchaseOrder;
const VENDOR_ID = A11Y_SMOKE_IDS.vendor;

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
    path: A11Y_SMOKE_PATHS_BY_NAME['sales order detail'],
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
    path: A11Y_SMOKE_PATHS_BY_NAME['customer detail'],
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
    ready: async (page) => {
      await titleReady('Jane Smith')(page);
      // The tyre-set summary reads the lazy `inventory` namespace and shows raw keys until it loads.
      await expect(page.getByRole('button', { name: inventoryDe.tyreStorage.summary.addSet })).toBeVisible();
    },
  },
  {
    name: 'workshop order detail',
    path: A11Y_SMOKE_PATHS_BY_NAME['workshop order detail'],
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
    path: A11Y_SMOKE_PATHS_BY_NAME['purchase order detail'],
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
    path: A11Y_SMOKE_PATHS_BY_NAME['workshop board'],
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
    name: 'settings: overview',
    path: A11Y_SMOKE_PATHS_BY_NAME['settings: overview'],
    mock: async (page) => {
      await mockShellApis(page);
    },
    ready: titleReady(DE_SETTINGS.page.title),
  },
  {
    name: 'settings: finance',
    path: A11Y_SMOKE_PATHS_BY_NAME['settings: finance'],
    mock: async (page) => {
      await mockApi(page, '/api/finance/settings', createMockFinanceSettings());
      await mockApi(page, '/api/finance/revenue-groups', [
        createMockRevenueGroup({ name: 'Parts Revenue' }),
      ]);
    },
    ready: titleReady(DE_SETTINGS.tabs.finance),
  },
  {
    name: 'settings: brands',
    path: A11Y_SMOKE_PATHS_BY_NAME['settings: brands'],
    mock: async (page) => {
      await mockShellApis(page);
      await mockApi(page, '/api/finance/settings', createMockFinanceSettings());
      await mockApi(page, '/api/finance/revenue-groups', []);
      await mockApi(page, '/api/brands', createMockListResponse([createMockBrand({ name: 'Stellantis' })]));
    },
    ready: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.tabs.brands })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'settings: storage locations',
    path: A11Y_SMOKE_PATHS_BY_NAME['settings: storage locations'],
    mock: async (page) => {
      await mockApi(page, '/api/finance/settings', createMockFinanceSettings());
      await mockApi(page, '/api/inventory/locations/tree', [createMockStorageLocation({ name: 'Aisle F' })]);
    },
    ready: titleReady(DE_SETTINGS.tabs.locations),
  },
  {
    name: 'settings: labor',
    path: A11Y_SMOKE_PATHS_BY_NAME['settings: labor'],
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
    ready: titleReady(DE_SETTINGS.tabs.labor),
  },
  {
    name: 'customers list with add customer dialog open',
    path: A11Y_SMOKE_PATHS_BY_NAME['customers list with add customer dialog open'],
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
    path: A11Y_SMOKE_PATHS_BY_NAME['sales orders list'],
    mock: async (page) => {
      await mockApi(page, '/api/sales-orders', createMockListResponse([]));
    },
    ready: titleReady(),
  },
  {
    name: 'purchase orders list',
    path: A11Y_SMOKE_PATHS_BY_NAME['purchase orders list'],
    mock: async (page) => {
      await mockApi(page, '/api/purchase-orders', createMockListResponse([]));
    },
    ready: titleReady(),
  },
  {
    name: 'inventory list',
    path: A11Y_SMOKE_PATHS_BY_NAME['inventory list'],
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
    path: A11Y_SMOKE_PATHS_BY_NAME['vehicle stock list'],
    mock: async (page) => {
      await mockApi(page, '/api/vehicle-stock', createMockListResponse([]));
    },
    ready: titleReady(),
  },
  {
    name: 'vendors list',
    path: A11Y_SMOKE_PATHS_BY_NAME['vendors list'],
    mock: async (page) => {
      await mockApi(page, '/api/vendors', createMockListResponse([]));
    },
    ready: titleReady(),
  },
  {
    name: 'bank reconciliation',
    path: A11Y_SMOKE_PATHS_BY_NAME['bank reconciliation'],
    mock: async (page) => {
      await page.addInitScript(() => {
        window.localStorage.setItem('e2e-bank-reconciliation-enabled', 'true');
      });
      await mockShellApis(page);
      await mockApi(page, '/api/bank-reconciliation/transactions', {
        data: [
          {
            id: 'tx-a11y-1',
            legal_entity_id: 'le-a11y-1',
            import_id: 'imp-a11y-1',
            receiving_iban: 'AT611904300234573201',
            booking_date: '2026-11-10',
            value_date: '2026-11-10',
            amount: '1250.50',
            currency: 'EUR',
            is_credit: true,
            non_eur: false,
            remitter_name: 'Max Mustermann',
            remitter_iban_last4: '4321',
            reference_text: 'Rechnung RE-2026-0901',
            bank_ref: 'REF-A11Y-1',
            status: 'UNMATCHED',
            version: 1,
            createdAt: '2026-11-10T10:00:00.000Z',
          },
        ],
        meta: { nextCursor: null, hasNextPage: false },
      });
      await mockApi(page, '/api/bank-reconciliation/transactions/tx-a11y-1/suggestions', {
        data: [
          {
            invoiceId: 'inv-a11y-1',
            invoiceNumber: 'RE-2026-0901',
            outstandingAmount: '1250.50',
            suggestedAmount: '1250.50',
            remainingInvoiceAmount: '0.00',
            unallocatedTransferAmount: '0.00',
            score: 100,
            reasons: [
              { code: 'AMOUNT_EXACT', value: '1250.50' },
              { code: 'INVOICE_NO_IN_REFERENCE', value: 'RE-2026-0901' },
            ],
          },
        ],
      });
    },
    ready: async (page) => {
      await titleReady(financeDe.bankReconciliation.title)(page);
      await expect(page.getByText('RE-2026-0901').first()).toBeVisible();
    },
  },
];
