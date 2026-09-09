import { seedCustomersAndVehicles } from './customer.fixture';

describe('customer.fixture', () => {
  it('creates customers and batch creates vehicles', async () => {
    const mockPrisma: any = {
      customer: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: `cust-${data.first_name}`,
          ...data,
        })),
      },
      vehicle: {
        createMany: jest.fn().mockResolvedValue({ count: 7 }),
      },
    };

    const result = await seedCustomersAndVehicles(mockPrisma, 'tenant-1');

    expect(result.customers).toHaveLength(5);
    expect(result.vehicleCount).toBe(6);
    expect(mockPrisma.customer.create).toHaveBeenCalledTimes(5);
    expect(mockPrisma.vehicle.createMany).toHaveBeenCalledTimes(1);

    const vehicleArgs = mockPrisma.vehicle.createMany.mock.calls[0][0];
    expect(vehicleArgs.data).toHaveLength(6);
    expect(vehicleArgs.data[0].tenant_id).toBe('tenant-1');
    expect(vehicleArgs.data[0].customer_id).toBe('cust-Max');
  });
});
