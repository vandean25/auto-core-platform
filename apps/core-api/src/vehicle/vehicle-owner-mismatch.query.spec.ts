import { findVehicleOwnerMismatches } from './vehicle-owner-mismatch.query.js';

describe('findVehicleOwnerMismatches', () => {
  const tenantId = 'tenant-1';
  const row = (
    id: string,
    customerId: string | null,
    ownerCustomerId?: string,
  ) => ({
    id,
    customer_id: customerId,
    parties: ownerCustomerId ? [{ customer_id: ownerCustomerId }] : [],
  });

  it('lists only vehicles whose active OWNER differs from customer_id', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        row('veh-sync', 'cust-a', 'cust-a'),
        row('veh-drift', 'cust-b', 'cust-a'),
        row('veh-no-party', 'cust-a'),
        row('veh-cleared', null, 'cust-a'),
      ]);

    await expect(
      findVehicleOwnerMismatches(
        { vehicle: { findMany } } as never,
        tenantId,
        '2026-11-01',
      ),
    ).resolves.toEqual([
      {
        vehicle_id: 'veh-drift',
        customer_id: 'cust-b',
        owner_customer_id: 'cust-a',
      },
      {
        vehicle_id: 'veh-no-party',
        customer_id: 'cust-a',
        owner_customer_id: null,
      },
      {
        vehicle_id: 'veh-cleared',
        customer_id: null,
        owner_customer_id: 'cust-a',
      },
    ]);
  });

  it('reads with the tenant on the vehicles and on the OWNER parties, and writes nothing', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const db = { vehicle: { findMany }, vehicleParty: { create: jest.fn() } };

    await findVehicleOwnerMismatches(db as never, tenantId, '2026-11-01');

    const [args] = findMany.mock.calls[0];
    expect(args.where.tenant_id).toBe(tenantId);
    expect(args.select.parties.where).toMatchObject({
      tenant_id: tenantId,
      role: 'OWNER',
    });
    expect(db.vehicleParty.create).not.toHaveBeenCalled();
    expect(Object.keys(db.vehicle)).toEqual(['findMany']);
  });
});
