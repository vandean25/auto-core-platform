import { VehicleListingPlatform } from '@prisma/client';
import type { EquipmentListingSerializerProfile } from '../equipment/vehicle-equipment-portal-map.types.js';
import { VEHICLE_EQUIPMENT_PORTAL_MAPS_V1 } from '../equipment/vehicle-equipment-portal-maps.v1.js';

export interface VehicleListingPlatformDefaults {
  platform: VehicleListingPlatform;
  serializer_profile: EquipmentListingSerializerProfile;
  mapping_version: string;
}

export const VEHICLE_LISTING_PLATFORM_DEFAULTS: readonly VehicleListingPlatformDefaults[] =
  [
    {
      platform: VehicleListingPlatform.MOBILE_DE,
      serializer_profile: 'MOBILE_DE_REFERENCE_V1',
      mapping_version: VEHICLE_EQUIPMENT_PORTAL_MAPS_V1.version,
    },
    {
      platform: VehicleListingPlatform.AS24,
      serializer_profile: 'AS24_PROVISIONAL_V1',
      mapping_version: VEHICLE_EQUIPMENT_PORTAL_MAPS_V1.version,
    },
    {
      platform: VehicleListingPlatform.WILLHABEN,
      serializer_profile: 'WILLHABEN_GENERIC_V1',
      mapping_version: VEHICLE_EQUIPMENT_PORTAL_MAPS_V1.version,
    },
  ];
