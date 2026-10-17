import { seedVehicleEquipmentOptions } from './seed-vehicle-equipment-options.js';
import { VEHICLE_EQUIPMENT_STARTER_DEFINITIONS } from './vehicle-equipment-taxonomy.js';

describe('seedVehicleEquipmentOptions', () => {
  it('upserts starter taxonomy codes idempotently per tenant', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const prisma = {
      vehicleEquipmentOption: {
        upsert: jest.fn(async ({ where, create, update }) => {
          const key = `${where.tenant_id_code.tenant_id}:${where.tenant_id_code.code}`;
          const existing = store.get(key);
          if (existing) {
            const next = { ...existing, ...update };
            store.set(key, next);
            return next;
          }
          const row = { id: `opt-${key}`, ...create };
          store.set(key, row);
          return row;
        }),
      },
    };

    const first = await seedVehicleEquipmentOptions(prisma, 'tenant-1');
    const second = await seedVehicleEquipmentOptions(prisma, 'tenant-1');

    expect(first.optionsUpserted).toBe(
      VEHICLE_EQUIPMENT_STARTER_DEFINITIONS.length,
    );
    expect(second.optionsUpserted).toBe(
      VEHICLE_EQUIPMENT_STARTER_DEFINITIONS.length,
    );
    expect(store.size).toBe(VEHICLE_EQUIPMENT_STARTER_DEFINITIONS.length);
    expect(prisma.vehicleEquipmentOption.upsert).toHaveBeenCalledTimes(
      VEHICLE_EQUIPMENT_STARTER_DEFINITIONS.length * 2,
    );
  });
});
