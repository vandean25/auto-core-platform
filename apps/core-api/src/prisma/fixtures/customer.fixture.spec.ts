import { seedCustomersAndVehicles } from './customer.fixture.js';

describe('customer.fixture', () => {
  it('upserts customers and creates vehicles when missing', async () => {
    const mockPrisma: any = {
      customer: {
        upsert: jest.fn().mockImplementation(async ({ create }) => ({
          id: `cust-${create.first_name}`,
          ...create,
        })),
      },
      vehicle: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: `veh-${data.vin}`,
          ...data,
        })),
      },
      importMappingProfile: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const result = await seedCustomersAndVehicles(mockPrisma, 'tenant-1');

    expect(result.customers).toHaveLength(5);
    expect(result.vehicleCount).toBe(6);
    expect(mockPrisma.customer.upsert).toHaveBeenCalledTimes(5);
    expect(mockPrisma.vehicle.create).toHaveBeenCalledTimes(6);

    const vehicleArgs = mockPrisma.vehicle.create.mock.calls[0][0];
    expect(vehicleArgs.data.tenant_id).toBe('tenant-1');
    expect(vehicleArgs.data.customer_id).toBe('cust-Max');
  });
});
