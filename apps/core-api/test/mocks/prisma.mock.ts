export const mockPrismaService = {
  financeSettings: {
    upsert: jest.fn().mockResolvedValue({
      id: 1,
      workshop_order_prefix: 'WO-2026-',
      next_workshop_order_number: 1001,
    }),
    update: jest.fn().mockResolvedValue({
      workshop_order_prefix: 'WO-2026-',
      next_workshop_order_number: 1002,
    }),
  },
  workshopOrder: {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockImplementation((args) =>
      Promise.resolve({
        id: 'mock-order-id',
        status: 'INTAKE',
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
  },
  vehicle: {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue([
      {
        id: 'mock-vehicle-id',
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        vin: 'TESTVIN123456789',
        plate: 'W-1234AB',
        customer: {
          id: 'mock-customer-id',
          first_name: 'Workshop',
          last_name: 'Tester',
        },
      },
    ]),
    findUnique: jest.fn().mockImplementation((args) => {
      if (args?.where?.id === 'mock-vehicle-id') {
        return Promise.resolve({
          id: 'mock-vehicle-id',
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
          vin: 'TESTVIN123456789',
          plate: 'W-1234AB',
          customer_id: 'mock-customer-id',
        });
      }
      return Promise.resolve(null);
    }),
    create: jest.fn().mockResolvedValue({
      id: 'mock-vehicle-id',
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
      vin: 'TESTVIN123456789',
      plate: 'W-1234AB',
      customer_id: 'mock-customer-id',
    }),
    upsert: jest.fn().mockResolvedValue({
      id: 'mock-vehicle-id',
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
      vin: 'TESTVIN123456789',
      plate: 'W-1234AB',
      customer_id: 'mock-customer-id',
      customer: { id: 'mock-customer-id' },
    }),
  },
  customer: {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockImplementation((args) => {
      if (args?.where?.id === 'mock-customer-id')
        return Promise.resolve({
          id: 'mock-customer-id',
          first_name: 'Workshop',
          last_name: 'Tester',
          email: 'workshop@test.com',
          type: 'PRIVATE',
        });
      if (args?.where?.email === 'workshop@test.com')
        return Promise.resolve({
          id: 'mock-customer-id',
          first_name: 'Workshop',
          last_name: 'Tester',
          email: 'workshop@test.com',
          type: 'PRIVATE',
        });
      return Promise.resolve(null);
    }),
    create: jest.fn().mockResolvedValue({
      id: 'mock-customer-id',
      first_name: 'Workshop',
      last_name: 'Tester',
      email: 'workshop@test.com',
      type: 'PRIVATE',
    }),
  },
};
