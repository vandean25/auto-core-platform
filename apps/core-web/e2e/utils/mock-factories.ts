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

type MockVendorShape = {
  id: string;
  name: string;
  status: string;
  email: string | null;
  phone: string | null;
  address: string | null;
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
  vendor: MockVendorShape;
};

export const createMockPurchaseBill = (
  overrides: Partial<MockPurchaseBill> = {},
): MockPurchaseBill => ({
  id: 'bill-123',
  vendor_invoice_number: 'B-2026-001',
  status: 'DRAFT',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: new Date().toISOString().slice(0, 10),
  total_amount: '0.00',
  lines: [],
  vendor: createMockVendor(),
  ...overrides,
});

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
  lineItems: unknown[];
  mechanicNotes: string;
};

type MockWorkshopOrder = {
  id: string;
  order_number: string;
  status: string;
  reported_issue: string;
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
  order_number: 'WS-2026-001',
  status: 'OPEN',
  reported_issue: 'Vehicle maintenance',
  customer: createMockCustomer(),
  vehicle: createMockVehicle(),
  tasks: [
    {
      id: 'TASK-1',
      title: 'General Inspection',
      done: false,
      status: 'NOT_STARTED',
      lineItems: [],
      mechanicNotes: '',
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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
 */
export const createMockListResponse = <T>(items: T[], total = items.length) => ({
  data: items,
  meta: {
    total,
    page: 1,
    limit: 10,
    pageCount: Math.ceil(total / 10),
  },
});
