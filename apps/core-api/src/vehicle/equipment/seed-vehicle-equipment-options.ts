import type { Prisma } from '@prisma/client';
import { chunkedPromiseAll } from '../../common/utils/promise.util.js';
import { VEHICLE_EQUIPMENT_STARTER_DEFINITIONS } from './vehicle-equipment-taxonomy.js';

type EquipmentSeedClient = {
  vehicleEquipmentOption: {
    upsert: (args: Prisma.VehicleEquipmentOptionUpsertArgs) => Promise<unknown>;
  };
};

export interface VehicleEquipmentSeedSummary {
  optionsUpserted: number;
}

export async function seedVehicleEquipmentOptions(
  prisma: EquipmentSeedClient,
  tenantId: string,
): Promise<VehicleEquipmentSeedSummary> {
  await chunkedPromiseAll(VEHICLE_EQUIPMENT_STARTER_DEFINITIONS, (definition) =>
    prisma.vehicleEquipmentOption.upsert({
      where: {
        tenant_id_code: {
          tenant_id: tenantId,
          code: definition.code,
        },
      },
      update: {
        label_de: definition.label_de,
        label_en: definition.label_en,
        category: definition.category,
      },
      create: {
        tenant_id: tenantId,
        code: definition.code,
        label_de: definition.label_de,
        label_en: definition.label_en,
        category: definition.category,
        active: true,
      },
    }),
  );

  return { optionsUpserted: VEHICLE_EQUIPMENT_STARTER_DEFINITIONS.length };
}
