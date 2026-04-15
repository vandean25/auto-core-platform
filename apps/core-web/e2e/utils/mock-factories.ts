/**
 * Mock data factories aligned with Auto Core OpenAPI definitions.
 */

export const createMockVehicle = (overrides = {}) => ({
  id: 'veh-123',
  make: 'Skoda',
  model: 'Octavia',
  year: 2020,
  plate: 'SK-2020-OCT',
  ...overrides,
});

export const createMockCustomer = (overrides = {}) => ({
  id: 'cust-123',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john.doe@example.com',
  ...overrides,
});

export const createMockWorkshopOrder = (overrides = {}) => ({
  id: 'ws-123',
  order_number: 'SO-2024-001',
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

export const createMockLaborOperation = (overrides = {}) => ({
  id: 'labor-1',
  code: 'L001',
  description: 'Standard Service',
  standardAw: 1.0,
  hourlyRate: 100,
  ...overrides,
});

export const createMockInventoryItem = (overrides = {}) => ({
  id: 'item-1',
  sku: 'TEST-SKU-1',
  name: 'Test Item Name',
  brand: 'Bosch',
  status: 'IN_STOCK',
  price: 100,
  stock_quantity: 10,
  ...overrides,
});
