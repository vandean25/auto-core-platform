import { ConflictException } from '@nestjs/common';
import { RegistrationIntakeApplyService } from './registration-intake-apply.service.js';

const TENANT_ID = 'tenant-1';
const VEHICLE_ID = 'veh-1';

const vehicle = {
  id: VEHICLE_ID,
  vin: 'VIN-1',
  plate: 'W-1',
  customer_id: 'cust-old',
  identity_resolution_generation: null,
  identity_resolution_token: null,
  national_code: null,
  first_registration_date: null,
  co2_wltp_g_km: null,
  co2_nedc_g_km: null,
};

const ownerRow = {
  id: 'party-old',
  tenant_id: TENANT_ID,
  vehicle_id: VEHICLE_ID,
  customer_id: 'cust-old',
  role: 'OWNER',
  valid_from: new Date('2020-01-01T00:00:00.000Z'),
  valid_to: null,
  source: 'MANUAL',
  notes: null,
  createdAt: new Date('2020-01-01T00:00:00.000Z'),
};

function buildTx(updateCount = 1) {
  return {
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(vehicle),
      updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
    },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-new' }) },
    vehicleParty: {
      // The second read sees the ended OWNER, as it does in the database.
      findMany: jest
        .fn()
        .mockResolvedValueOnce([ownerRow])
        .mockResolvedValue([{ ...ownerRow, valid_to: new Date() }]),
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'party-new', ...data })),
    },
  };
}

function updateExistingVehicle(tx: ReturnType<typeof buildTx>, dto: object) {
  const service = new RegistrationIntakeApplyService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const run = (
    service as unknown as {
      updateExistingVehicle: (...args: unknown[]) => Promise<void>;
    }
  ).updateExistingVehicle.bind(service);
  return run(tx, TENANT_ID, VEHICLE_ID, 'cust-new', dto);
}

describe('RegistrationIntakeApplyService ownership correction', () => {
  const dto = {
    plate: 'W-1',
    ownershipCorrection: {
      expectedCustomerId: 'cust-old',
      nextCustomerId: 'cust-new',
    },
  };

  it('moves the OWNER party and customer_id together, not customer_id on its own', async () => {
    const tx = buildTx();

    await updateExistingVehicle(tx, dto);

    // The guarded update keeps the expected holder in its filter but writes no customer_id.
    const [guarded] = tx.vehicle.updateMany.mock.calls[0];
    expect(guarded.where).toMatchObject({ customer_id: 'cust-old' });
    expect(guarded.data).not.toHaveProperty('customer_id');
    expect(tx.vehicleParty.update).toHaveBeenCalledWith({
      where: { tenant_id_id: { tenant_id: TENANT_ID, id: 'party-old' } },
      data: { valid_to: expect.any(Date) },
    });
    expect(tx.vehicleParty.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vehicle_id: VEHICLE_ID,
        customer_id: 'cust-new',
        role: 'OWNER',
        source: 'MANUAL',
      }),
    });
    expect(tx.vehicle.updateMany).toHaveBeenLastCalledWith({
      where: { id: VEHICLE_ID, tenant_id: TENANT_ID },
      data: { customer_id: 'cust-new' },
    });
  });

  it('writes no party when the holder changed under the guarded update', async () => {
    const tx = buildTx(0);

    await expect(updateExistingVehicle(tx, dto)).rejects.toThrow(
      ConflictException,
    );
    expect(tx.vehicleParty.create).not.toHaveBeenCalled();
    expect(tx.vehicleParty.update).not.toHaveBeenCalled();
  });

  it('leaves the owner alone without an ownership correction', async () => {
    const tx = buildTx();
    tx.vehicle.findFirst.mockResolvedValue({
      ...vehicle,
      customer_id: 'cust-new',
    });

    await updateExistingVehicle(tx, { plate: 'W-1' });

    expect(tx.vehicleParty.create).not.toHaveBeenCalled();
    expect(tx.vehicleParty.update).not.toHaveBeenCalled();
  });
});
