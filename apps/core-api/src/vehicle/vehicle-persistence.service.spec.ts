import { PrismaService } from '../prisma/prisma.service.js';
import { VehiclePersistenceService } from './vehicle-persistence.service.js';

describe('VehiclePersistenceService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  let prisma: {
    vehicle: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    customer: { findFirst: jest.Mock };
    workshopOrder: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let service: VehiclePersistenceService;

  beforeEach(() => {
    prisma = {
      vehicle: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      customer: { findFirst: jest.fn() },
      workshopOrder: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    service = new VehiclePersistenceService(prisma as unknown as PrismaService);
  });

  it('reads identity state only inside the tenant', async () => {
    prisma.vehicle.findFirst.mockResolvedValue(null);

    await expect(service.findIdentityForUpdate('vehicle-1', tenantId)).resolves.toBeNull();

    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: 'vehicle-1', tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
    });
  });

  it('checks customer existence only inside the tenant', async () => {
    prisma.customer.findFirst.mockResolvedValueOnce({ id: 'cust-1' });
    prisma.customer.findFirst.mockResolvedValueOnce(null);

    await expect(service.customerExists('cust-1', tenantId)).resolves.toBe(true);
    await expect(service.customerExists('cust-2', tenantId)).resolves.toBe(false);

    expect(prisma.customer.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: 'cust-1', tenant_id: tenantId },
      select: { id: true },
    });
  });

  describe('createVehicle', () => {
    const data = { make: 'Ford', model: 'Focus', year: 2021, tenant_id: tenantId };

    function buildCreateTx() {
      const tx = {
        vehicle: {
          create: jest.fn().mockResolvedValue({ id: 'vehicle-1', tenant_id: tenantId }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'vehicle-1', customer: { id: 'cust-1' } }),
        },
        vehicleParty: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockImplementation(({ data: party }) => ({ id: 'p-1', ...party })),
        },
        customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
      };
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx));
      return tx;
    }

    it('creates a vehicle without an owner in one write, with its customer relation included', async () => {
      const tx = buildCreateTx();

      await expect(service.createVehicle(data)).resolves.toEqual({
        id: 'vehicle-1',
        tenant_id: tenantId,
      });

      expect(tx.vehicle.create).toHaveBeenCalledWith({
        data,
        include: { customer: true },
      });
      expect(tx.vehicleParty.create).not.toHaveBeenCalled();
      expect(tx.vehicle.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it('starts the OWNER and sets customer_id through the party writer, not in the create data', async () => {
      const tx = buildCreateTx();

      await expect(
        service.createVehicle({ ...data, customer_id: 'cust-1' }),
      ).resolves.toEqual({ id: 'vehicle-1', customer: { id: 'cust-1' } });

      expect(tx.vehicle.create.mock.calls[0][0].data).toMatchObject({
        tenant_id: tenantId,
      });
      expect(tx.vehicle.create.mock.calls[0][0].data).not.toHaveProperty(
        'customer_id',
      );
      expect(tx.vehicleParty.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vehicle_id: 'vehicle-1',
          customer_id: 'cust-1',
          role: 'OWNER',
          source: 'MANUAL',
        }),
      });
      expect(tx.vehicle.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'vehicle-1', tenant_id: tenantId },
        data: { customer_id: 'cust-1' },
      });
    });
  });

  it('applies the identity guard and returns the matched row count', async () => {
    prisma.vehicle.updateMany.mockResolvedValue({ count: 0 });

    const count = await service.updateIfIdentityUnchanged(
      'vehicle-1',
      tenantId,
      {
        id: 'vehicle-1',
        vin: 'VIN-1',
        plate: 'PLATE-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: null,
      },
      { make: 'Ford' },
    );

    expect(count).toBe(0);
    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'vehicle-1',
        tenant_id: tenantId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: null,
      },
      data: { make: 'Ford' },
    });
  });

  it('reports whether a vehicle still exists in the tenant', async () => {
    prisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
    prisma.vehicle.findFirst.mockResolvedValueOnce(null);

    await expect(service.vehicleExists('vehicle-1', tenantId)).resolves.toBe(true);
    await expect(service.vehicleExists('vehicle-1', tenantId)).resolves.toBe(false);

    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: 'vehicle-1', tenant_id: tenantId },
      select: { id: true },
    });
  });

  it('re-reads a vehicle with its customer inside the tenant', async () => {
    await service.findVehicleWithCustomer('vehicle-1', tenantId);

    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: 'vehicle-1', tenant_id: tenantId },
      include: { customer: true },
    });
  });

  it('scopes every site-owned detail history to the authorized sites', async () => {
    await service.findVehicleDetail('vehicle-1', tenantId, [siteId]);

    const { where, include } = prisma.vehicle.findFirst.mock.calls[0][0];
    const siteScope = { site_id: { in: [siteId] } };

    expect(where).toEqual({ id: 'vehicle-1', tenant_id: tenantId });
    expect(include.sales_orders.where).toEqual(siteScope);
    expect(include.workshop_orders.where).toEqual(siteScope);
    expect(include.purchases.where).toEqual(siteScope);
    expect(include.sales.where).toEqual(siteScope);
  });

  it('loads the active parties and open service-due notices inside the tenant', async () => {
    await service.findVehicleDetail('vehicle-1', tenantId, [siteId]);

    const { include } = prisma.vehicle.findFirst.mock.calls[0][0];

    expect(include.parties.where).toMatchObject({ tenant_id: tenantId });
    expect(include.parties.where.AND).toHaveLength(2);
    expect(include.notices.where).toEqual({
      tenant_id: tenantId,
      type: 'SERVICE_DUE',
      status: 'OPEN',
    });
  });

  it('lists a page of vehicles with the same where clause used for counting', async () => {
    const where = { tenant_id: tenantId };
    const orderBy = { make: 'asc' as const };
    prisma.vehicle.findMany.mockResolvedValue([{ id: 'vehicle-1' }]);
    prisma.vehicle.count.mockResolvedValue(1);

    await expect(
      service.listVehicles({ where, orderBy, skip: 10, take: 10 }),
    ).resolves.toEqual({ rows: [{ id: 'vehicle-1' }], total: 1 });

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where,
      include: { customer: true, location: true, reserved_for_customer: true },
      skip: 10,
      take: 10,
      orderBy,
    });
    expect(prisma.vehicle.count).toHaveBeenCalledWith({ where });
  });

  it('loads Pickerl candidates with their latest inspection records first', async () => {
    const where = { tenant_id: tenantId, inventory_role: 'CUSTOMER' as const };

    await service.findPickerlCandidates(where);

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where,
      include: {
        customer: true,
        inspection_records: {
          orderBy: { inspected_on: 'desc' },
          select: {
            inspected_on: true,
            plaketten_valid_until_year: true,
            plaketten_valid_until_month: true,
            source: true,
            external_inspection_result_id: true,
          },
        },
      },
    });
  });

  it('finds open Pickerl orders for the given vehicles in the active tenant and site', async () => {
    await service.findOpenPickerlOrders(tenantId, siteId, ['vehicle-1', 'vehicle-2']);

    expect(prisma.workshopOrder.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: { in: ['vehicle-1', 'vehicle-2'] },
        status: { in: ['SCHEDULED', 'INTAKE', 'IN_PROGRESS'] },
        tasks: { some: { title: '§57a Begutachtung' } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, order_number: true, vehicle_id: true },
    });
  });

  it('finds the newest open Pickerl order for one vehicle in the active tenant and site', async () => {
    await service.findOpenPickerlOrder('vehicle-1', tenantId, siteId);

    expect(prisma.workshopOrder.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: 'vehicle-1',
        status: { in: ['SCHEDULED', 'INTAKE', 'IN_PROGRESS'] },
        tasks: { some: { title: '§57a Begutachtung' } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, order_number: true },
    });
  });

  describe('updateIfIdentityUnchangedWithMainContact', () => {
    function buildTx(currentCustomerId: string | null, count = 1) {
      const tx = {
        vehicle: {
          findFirst: jest.fn().mockResolvedValue({ customer_id: currentCustomerId }),
          // First call is the row lock, the second the guarded update.
          updateMany: jest
            .fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValue({ count }),
        },
        vehicleParty: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({
            id: 'p-new',
            role: 'OWNER',
            customer_id: 'cust-2',
            valid_from: new Date('2026-11-01T00:00:00.000Z'),
            valid_to: null,
          }),
        },
        customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-2' }) },
      };
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx));
      return tx;
    }

    const input = (customerId: string | null) => ({
      id: 'vehicle-1',
      tenantId,
      existingVehicle: { id: 'vehicle-1', vin: null, plate: null },
      data: { customer_id: customerId },
      customerId,
      today: '2026-11-01',
    });

    it('hands the OWNER over when the customer really changes', async () => {
      const tx = buildTx('cust-1');

      await expect(
        service.updateIfIdentityUnchangedWithMainContact(input('cust-2')),
      ).resolves.toBe(1);

      expect(tx.vehicleParty.findMany).toHaveBeenCalled();
      expect(tx.vehicleParty.create).toHaveBeenCalled();
      // customer_id reaches the row only through the party writer (the last updateMany).
      expect(tx.vehicle.updateMany.mock.calls[1][0].data).not.toHaveProperty('customer_id');
    });

    it('does not touch the parties when the customer is repeated', async () => {
      const tx = buildTx('cust-1');

      await service.updateIfIdentityUnchangedWithMainContact(input('cust-1'));

      expect(tx.vehicleParty.findMany).not.toHaveBeenCalled();
      expect(tx.vehicleParty.create).not.toHaveBeenCalled();
    });

    it('writes no party when the identity guard is stale', async () => {
      const tx = buildTx('cust-1', 0);

      await expect(
        service.updateIfIdentityUnchangedWithMainContact(input('cust-2')),
      ).resolves.toBe(0);
      expect(tx.vehicleParty.findMany).not.toHaveBeenCalled();
    });
  });
});
