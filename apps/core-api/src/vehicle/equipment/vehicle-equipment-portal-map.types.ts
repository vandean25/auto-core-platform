export type EquipmentPortalVerification = 'VERIFIED' | 'UNVERIFIED';

export type EquipmentListingSerializerProfile =
  'MOBILE_DE_REFERENCE_V1' | 'AS24_PROVISIONAL_V1' | 'WILLHABEN_GENERIC_V1';

export interface EquipmentPortalMapEntry {
  local_code: string;
  profile: EquipmentListingSerializerProfile;
  portal_field: string;
  portal_value: string;
  verification: EquipmentPortalVerification;
  source: string;
  version: string;
}

export interface EquipmentPortalProfileConfig {
  verification: EquipmentPortalVerification;
  source: string;
  version: string;
  /** When true, every selected taxonomy code is emitted in equipment_codes (provisional CSV profiles). */
  export_local_codes?: boolean;
  entries: EquipmentPortalMapEntry[];
}

export interface EquipmentPortalMapDocument {
  version: string;
  profiles: Record<
    EquipmentListingSerializerProfile,
    EquipmentPortalProfileConfig
  >;
}

export type VehicleEquipmentAssertionState = 'PRESENT' | 'ABSENT';

export interface VehicleEquipmentSelectionInput {
  code: string;
  label_de: string;
  label_en: string;
  assertion: VehicleEquipmentAssertionState;
}

export interface ResolvedPortalEquipmentField {
  localCode: string;
  portalField: string;
  portalValue: string;
  verification: EquipmentPortalVerification;
}

export interface ResolvedVehicleEquipmentExport {
  profile: EquipmentListingSerializerProfile;
  mappingVersion: string;
  profileVerification: EquipmentPortalVerification;
  mappedFields: ResolvedPortalEquipmentField[];
  equipmentCodes: string[];
  equipmentFreeTextLines: string[];
}
