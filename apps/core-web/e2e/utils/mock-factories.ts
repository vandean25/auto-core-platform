/**
 * Mock data factories for Auto Core Platform E2E tests.
 *
 * Each factory returns a minimal object that matches the shape returned by
 * the real API (aligned with `src/api/generated/openapi.ts` and the Prisma schema).
 * Use `overrides` to customise individual fields per test.
 *
 * Schema-First Rule: When the Prisma schema or OpenAPI contract changes, update
 * the relevant factory here so that mock data never drifts from the real API shape.
 */

// ---------------------------------------------------------------------------
// Shared sub-entities
// ---------------------------------------------------------------------------

export const createMockVehicle = (overrides: Record<string, unknown> = {}) => ({
  id: 'veh-123',
  make: 'Skoda',
  model: 'Octavia',
  year: 2020,
  plate: 'SK-2020-OCT',
  ...overrides,
});

export const createMockCustomer = (overrides: Record<string, unknown> = {}) => ({
  id: 'cust-123',
  type: 'PRIVATE' as const,
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  email: 'john.doe@example.com',
  phone: null,
  ...overrides,
});

export const createMockVendor = (overrides: Record<string, unknown> = {}) => ({
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

export const createMockInventoryItem = (overrides: Record<string, unknown> = {}) => ({
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

export const createMockPurchaseOrder = (overrides: Record<string, unknown> = {}) => ({
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

export const createMockPurchaseBill = (overrides: Record<string, unknown> = {}) => ({
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

export const createMockSalesOrder = (overrides: Record<string, unknown> = {}) => ({
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

export const createMockWorkshopOrder = (overrides: Record<string, unknown> = {}) => ({
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

export const createMockLaborOperation = (overrides: Record<string, unknown> = {}) => ({
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
