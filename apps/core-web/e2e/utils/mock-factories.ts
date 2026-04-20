/**
 * Mock data factories for Auto Core Platform E2E tests.
 *
 * Each factory accepts a strongly-typed `overrides` object so TypeScript can
 * validate that callers only provide fields that exist on the returned shape
 * (aligned with `src/api/generated/openapi.ts` and the Prisma schema).
 *
 * Schema-First Rule: When the Prisma schema or OpenAPI contract changes, update
 * the relevant factory here so that mock data never drifts from the real API shape.
 */

// ---------------------------------------------------------------------------
// Shared sub-entities
// ---------------------------------------------------------------------------

type MockVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  plate: string;
};

type MockCustomer = {
  id: string;
  type: 'PRIVATE' | 'COMPANY';
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
};

/** Minimal brand shape used inside vendor/test payloads. */
type MockBrand = {
  id: number;
  name: string;
};

/**
 * Aligns with the frontend `Vendor` interface from `src/api/types.ts`.
 * Includes `account_number` and `supportedBrands` so vendor-related mocks
 * remain type-safe without needing `as any` or manual spreads.
 */
type MockVendorShape = {
  id: string;
  name: string;
  status: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  account_number: string;
  supportedBrands: MockBrand[];
};

export const createMockVehicle = (overrides: Partial<MockVehicle> = {}): MockVehicle => ({
  id: 'veh-123',
  make: 'Skoda',
  model: 'Octavia',
  year: 2020,
  plate: 'SK-2020-OCT',
  ...overrides,
});

export const createMockCustomer = (overrides: Partial<MockCustomer> = {}): MockCustomer => ({
  id: 'cust-123',
  type: 'PRIVATE',
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  email: 'john.doe@example.com',
  phone: null,
  ...overrides,
});

export const createMockVendor = (overrides: Partial<MockVendorShape> = {}): MockVendorShape => ({
  id: 'vendor-123',
  name: 'Bosch Automotive',
  status: 'ACTIVE',
  email: 'vendor@bosch.com',
  phone: null,
  address: null,
  account_number: 'ACC-001',
  supportedBrands: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

type MockInventoryItem = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  status: string;
  price: number;
  stock_quantity: number;
};

export const createMockInventoryItem = (
  overrides: Partial<MockInventoryItem> = {},
): MockInventoryItem => ({
  id: 'item-1',
  sku: 'TEST-SKU-1',
  name: 'Test Item Name',
  brand: 'Bosch',
  status: 'IN_STOCK',
  price: 100,
  stock_quantity: 10,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

type MockPurchaseOrder = {
  id: string;
  order_number: string;
  status: string;
  vendor: MockVendorShape;
  items: unknown[];
  createdAt: string;
  updatedAt: string;
};

export const createMockPurchaseOrder = (
  overrides: Partial<MockPurchaseOrder> = {},
): MockPurchaseOrder => ({
  id: 'po-123',
  order_number: 'PO-2026-0001',
  status: 'DRAFT',
  vendor: createMockVendor(),
  items: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Purchase Bills (Purchase Invoices)  — backend endpoint: /api/purchase-invoices
// ---------------------------------------------------------------------------

type MockPurchaseBill = {
  id: string;
  vendor_invoice_number: string;
  status: string;
  invoice_date: string;
  due_date: string;
  total_amount: string;
  lines: unknown[];
  vendor_id: string;
  vendor: MockVendorShape;
  createdAt: string;
  updatedAt: string;
};

export const createMockPurchaseBill = (
  overrides: Partial<MockPurchaseBill> = {},
): MockPurchaseBill => {
  const vendor = overrides.vendor ?? createMockVendor();
  const now = new Date().toISOString();
  return {
    id: 'bill-123',
    vendor_invoice_number: 'B-2026-001',
    status: 'DRAFT',
    invoice_date: now.slice(0, 10),
    due_date: now.slice(0, 10),
    total_amount: '0.00',
    lines: [],
    vendor_id: vendor.id,
    vendor,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

// ---------------------------------------------------------------------------
// Sales Orders
// ---------------------------------------------------------------------------

type MockSalesOrder = {
  id: string;
  order_number: string;
  status: string;
  customer: MockCustomer;
  vehicle: MockVehicle;
  total_amount: string;
  createdAt: string;
  updatedAt: string;
};

export const createMockSalesOrder = (
  overrides: Partial<MockSalesOrder> = {},
): MockSalesOrder => ({
  id: 'so-123',
  order_number: 'SO-2026-0001',
  status: 'DRAFT',
  customer: createMockCustomer(),
  vehicle: createMockVehicle(),
  total_amount: '0.00',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Workshop Orders
// ---------------------------------------------------------------------------

type MockWorkshopTask = {
  id: string;
  title: string;
  done: boolean;
  status: string;
  lineItems: MockWorkshopTaskLineItem[];
  mechanicNotes: string;
};

type MockWorkshopTaskLineItem = {
  id: string;
  type: 'PART' | 'LABOR';
  itemNo: string;
  description: string;
  qty: number;
  unitPrice: number;
};

type MockWorkshopOrder = {
  id: string;
  order_number: string;
  status: string;
  reported_issue: string;
  staging_location_id?: string | null;
  stagingLocationId?: string | null;
  customer: MockCustomer;
  vehicle: MockVehicle;
  tasks: MockWorkshopTask[];
  createdAt: string;
  updatedAt: string;
};

export const createMockWorkshopOrder = (
  overrides: Partial<MockWorkshopOrder> = {},
): MockWorkshopOrder => ({
  id: 'ws-123',
  order_number: 'WO-2026-0001',
  status: 'INTAKE',
  reported_issue: 'Vehicle maintenance',
  staging_location_id: null,
  stagingLocationId: null,
  customer: createMockCustomer(),
  vehicle: createMockVehicle(),
  tasks: [
    {
      id: 'TASK-1',
      title: 'General Inspection',
      done: false,
      status: 'NOT_STARTED',
      lineItems: [
        {
          id: 'line-1',
          type: 'PART',
          itemNo: '06J-115-403-Q',
          description: 'Oil Filter',
          qty: 2,
          unitPrice: 19.9,
        },
      ],
      mechanicNotes: '',
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Customer Detail (full detail response including related entities)
// ---------------------------------------------------------------------------

type MockCustomerDetailSalesOrder = {
  id: string;
  order_number: string;
  status: string;
  total_amount: string;
  createdAt: string;
};

type MockCustomerDetailWorkshopOrder = {
  id: string;
  order_number: string;
  status: string;
  createdAt: string;
  tasks: MockCustomerDetailWorkshopTask[];
};

type MockCustomerDetailWorkshopTask = {
  lineItems: MockCustomerDetailLineItem[];
};

type MockCustomerDetailLineItem = {
  quantity: number;
  unitPrice: number;
};

type MockCustomerDetailInvoice = {
  id: string;
  invoice_number: string;
  status: string;
  date: string;
  total_gross: string;
};

type MockCustomerDetailVehicle = MockVehicle & { vin: string };

type MockCustomerDetail = MockCustomer & {
  sales_orders: MockCustomerDetailSalesOrder[];
  workshop_orders: MockCustomerDetailWorkshopOrder[];
  invoices: MockCustomerDetailInvoice[];
  vehicles: MockCustomerDetailVehicle[];
};

export const createMockCustomerDetailResponse = (
  overrides: Partial<MockCustomerDetail> = {},
): MockCustomerDetail => ({
  id: 'cust-detail-123',
  type: 'PRIVATE',
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  email: 'john.doe@example.com',
  phone: null,
  sales_orders: [],
  workshop_orders: [],
  invoices: [],
  vehicles: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Storage Locations
// ---------------------------------------------------------------------------

type MockStorageLocation = {
  id: string;
  name: string;
  code: string;
  type: 'warehouse' | 'aisle' | 'shelf' | 'bin' | 'customer_storage' | 'staging_tote';
  parent_id?: string | null;
};

export const createMockStorageLocation = (
  overrides: Partial<MockStorageLocation> = {},
): MockStorageLocation => ({
  id: 'loc-tote-001',
  name: 'Staging Tote 001',
  code: 'TOTE-001',
  type: 'staging_tote',
  parent_id: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Labor
// ---------------------------------------------------------------------------

type MockLaborOperation = {
  id: string;
  code: string;
  description: string;
  standardAw: number;
  hourlyRate: number;
};

export const createMockLaborOperation = (
  overrides: Partial<MockLaborOperation> = {},
): MockLaborOperation => ({
  id: 'labor-1',
  code: 'L001',
  description: 'Standard Service',
  standardAw: 1.0,
  hourlyRate: 100,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Shared list response wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps an array of items in the standard `{ data, meta }` envelope that all
 * Auto Core list endpoints return.
 *
 * Some endpoints expose pagination as `pageCount` while others use
 * `totalPages`, so mocks include both keys.
 */
export const createMockListResponse = <T>(items: T[], total = items.length) => {
  const totalPages = Math.ceil(total / 10);

  return {
    data: items,
    meta: {
      total,
      page: 1,
      limit: 10,
      pageCount: totalPages,
      totalPages,
    },
  };
};
