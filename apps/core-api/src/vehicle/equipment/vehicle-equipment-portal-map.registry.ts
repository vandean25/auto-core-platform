import { UnprocessableEntityException } from '@nestjs/common';
import { VEHICLE_EQUIPMENT_PORTAL_MAPS_V1 } from './vehicle-equipment-portal-maps.v1.js';
import type {
  EquipmentListingSerializerProfile,
  EquipmentPortalMapDocument,
  EquipmentPortalProfileConfig,
} from './vehicle-equipment-portal-map.types.js';

const documentsByVersion = new Map<string, EquipmentPortalMapDocument>([
  [VEHICLE_EQUIPMENT_PORTAL_MAPS_V1.version, VEHICLE_EQUIPMENT_PORTAL_MAPS_V1],
]);

export function getEquipmentPortalMapDocument(
  version = VEHICLE_EQUIPMENT_PORTAL_MAPS_V1.version,
): EquipmentPortalMapDocument {
  const document = documentsByVersion.get(version);
  if (!document) {
    throw new UnprocessableEntityException({
      code: 'EQUIPMENT_PORTAL_MAP_UNSUPPORTED',
      message: `No equipment portal map is registered for version ${version}.`,
    });
  }
  return document;
}

export function getEquipmentPortalProfileConfig(
  profile: EquipmentListingSerializerProfile,
  version = VEHICLE_EQUIPMENT_PORTAL_MAPS_V1.version,
): EquipmentPortalProfileConfig {
  const document = getEquipmentPortalMapDocument(version);
  const config = document.profiles[profile];
  if (!config) {
    throw new UnprocessableEntityException({
      code: 'EQUIPMENT_PORTAL_PROFILE_UNSUPPORTED',
      message: `No equipment portal profile is registered for ${profile}.`,
    });
  }
  return config;
}
