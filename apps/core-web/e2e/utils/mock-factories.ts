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
  isVehicleMake: boolean;
  isPartManufacturer: boolean;
};

export const createMockBrand = (
  overrides: Partial<MockBrand> = {}
): MockBrand => ({
  id: 1,
  name: 'Bosch',
  isVehicleMake: false,
  isPartManufacturer: true,
  ...overrides,
});

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

export const createMockVehicleListItem = (overrides: Partial<MockVehicle & { customer: Partial<MockCustomer> }> = {}) => ({
  id: 'veh-list-123',
  make: 'Toyota',
  model: 'Corolla',
  year: 2021,
  engine_code: '2ZR-FAE',
  vin: 'JTD1234567890VIN',
  plate: 'TY-2021-COR',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  customer: createMockCustomer(),
  ...overrides,
});

type MockVehicleStockRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string | null;
  plate: string | null;
  color: string | null;
  stock_status: string | null;
  inventory_role: string;
  mileage: number | null;
  draft_purchase_id?: string | null;
};

export const createMockVehicleStockRow = (
  overrides: Partial<MockVehicleStockRow> = {},
): MockVehicleStockRow => ({
  id: 'stock-veh-123',
  make: 'Volkswagen',
  model: 'Golf',
  year: 2018,
  vin: 'WVWZZZ1JZXW000001',
  plate: 'W-GO-2018',
  color: 'Black',
  stock_status: 'IN_STOCK',
  inventory_role: 'USED',
  mileage: 98000,
  draft_purchase_id: null,
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

// ---------------------------------------------------------------------------
// Customer Detail Response (GET /api/customers/:id)
// ---------------------------------------------------------------------------

type MockSalesOrderSummary = {
  id: string;
  order_number: string;
  status: string;
  total_amount: string | number;
  createdAt: string;
};

type MockWorkshopLineItemSummary = {
  quantity: number;
  unitPrice: number;
};

type MockWorkshopTaskSummary = {
  lineItems?: MockWorkshopLineItemSummary[];
};

type MockWorkshopOrderSummary = {
  id: string;
  order_number?: string;
  status: string;
  createdAt: string;
  vehicle_id?: string;
  tasks?: MockWorkshopTaskSummary[];
};

type MockInvoiceSummary = {
  id: string;
  invoice_number: string | null;
  status: string;
  date: string;
  total_gross: string | number;
};

type MockVehicleDetail = MockVehicle & {
  vin?: string | null;
};

/**
 * Customer detail response shape used by the current CustomerDetail.tsx view.
 * This mock matches the local frontend shape consumed in E2E tests and does
 * not claim to include every field from the full GET /api/customers/:id API contract.
 */
type MockCustomerHistoryMeta = {
  page: number;
  pageSize: number;
  totalCount: number;
  pageCount: number;
  hasMore: boolean;
};

type MockCustomerDetailResponse = MockCustomer & {
  vat_id?: string | null;
  address_street?: string | null;
  address_zip?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  sales_orders?: MockSalesOrderSummary[];
  workshop_orders?: MockWorkshopOrderSummary[];
  invoices?: MockInvoiceSummary[];
  vehicles?: MockVehicleDetail[];
  workshop_orders_meta?: MockCustomerHistoryMeta;
  invoices_meta?: MockCustomerHistoryMeta;
};

export const createMockCustomerDetailResponse = (
  overrides: Partial<MockCustomerDetailResponse> = {},
): MockCustomerDetailResponse => ({
  id: 'cust-123',
  type: 'PRIVATE',
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  email: 'john.doe@example.com',
  phone: '+43 1 234 5678',
  vat_id: null,
  address_street: null,
  address_zip: null,
  address_city: null,
  address_country: null,
  sales_orders: [],
  workshop_orders: [],
  invoices: [],
  vehicles: [],
  workshop_orders_meta: {
    page: 1,
    pageSize: 10,
    totalCount: 0,
    pageCount: 1,
    hasMore: false,
  },
  invoices_meta: {
    page: 1,
    pageSize: 10,
    totalCount: 0,
    pageCount: 1,
    hasMore: false,
  },
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
  quantity_available: number;
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
  quantity_available: 10,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

type MockPurchaseOrder = {
  id: string;
  order_number: string;
  status: string;
  vendor_id: string;
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
  vendor_id: 'vendor-123',
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

type MockFinanceSettings = {
  id: number;
  fiscal_year_start_month: number;
  lock_date: string | null;
  invoice_prefix: string;
  next_invoice_number: number;
};

export const createMockFinanceSettings = (
  overrides: Partial<MockFinanceSettings> = {}
): MockFinanceSettings => ({
  id: 1,
  fiscal_year_start_month: 1,
  lock_date: null,
  invoice_prefix: 'INV-',
  next_invoice_number: 1000,
  ...overrides,
});

type MockRevenueGroup = {
  id: number;
  name: string;
  description?: string | null;
  tax_rate: number;
  account_number: string;
  is_default: boolean;
};

export const createMockRevenueGroup = (
  overrides: Partial<MockRevenueGroup> = {}
): MockRevenueGroup => ({
  id: 1,
  name: 'Parts Sales',
  description: 'Parts revenue',
  tax_rate: 25,
  account_number: '4000',
  is_default: true,
  ...overrides,
});

type MockEmployee = {
  id: string;
  name: string;
  role: 'MECHANIC' | 'SERVICE_ADVISOR' | 'PARTS_CLERK';
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const createMockEmployee = (
  overrides: Partial<MockEmployee> = {}
): MockEmployee => ({
  id: 'employee-1',
  name: 'Alex Novak',
  role: 'MECHANIC',
  isActive: true,
  sortOrder: 10,
  createdAt: '2026-04-21T09:00:00.000Z',
  updatedAt: '2026-04-21T09:00:00.000Z',
  ...overrides,
});

type MockBay = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const createMockBay = (
  overrides: Partial<MockBay> = {}
): MockBay => ({
  id: 'bay-1',
  name: 'Bay 01',
  isActive: true,
  sortOrder: 1,
  createdAt: '2026-04-21T09:15:00.000Z',
  updatedAt: '2026-04-21T09:15:00.000Z',
  ...overrides,
});

type MockLaborCategoryChild = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number | null;
  parent_id: string | null;
  default_hourly_rate: number | null;
  is_active: boolean;
  createdAt: string;
  updatedAt: string;
};

type MockLaborCategory = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number | null;
  parent_id: string | null;
  default_hourly_rate: number | null;
  is_active: boolean;
  createdAt: string;
  updatedAt: string;
  children: MockLaborCategoryChild[];
};

export const createMockLaborCategory = (
  overrides: Partial<MockLaborCategory> = {}
): MockLaborCategory => ({
  id: 'cat-1',
  name: 'Engine Repair',
  description: null,
  sort_order: 10,
  parent_id: null,
  default_hourly_rate: 150.00,
  is_active: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  children: [],
  ...overrides,
});

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
