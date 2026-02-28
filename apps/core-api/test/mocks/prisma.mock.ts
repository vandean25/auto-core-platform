export const mockPrismaService = {
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
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockImplementation((args) => {
      if (args.where.email === 'workshop@test.com')
        return Promise.resolve(null);
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
