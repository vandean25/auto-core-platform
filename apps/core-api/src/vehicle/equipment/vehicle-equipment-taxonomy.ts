/** Starter semantic equipment codes (AUT-566 / marketplace-export spec). */
export type VehicleEquipmentStarterCode =
  | 'ABS'
  | 'ESP'
  | 'AIR_CONDITIONING'
  | 'AUTOMATIC_CLIMATE'
  | 'ALLOY_WHEELS'
  | 'TOW_BAR'
  | 'NAVIGATION'
  | 'CRUISE_CONTROL'
  | 'SEAT_HEATING'
  | 'BLUETOOTH'
  | 'PARKING_FRONT'
  | 'PARKING_REAR'
  | 'PARKING_CAMERA'
  | 'ISOFIX';

export type VehicleEquipmentCategory =
  | 'SAFETY'
  | 'COMFORT'
  | 'EXTERIOR'
  | 'PARKING';

export interface VehicleEquipmentStarterDefinition {
  code: VehicleEquipmentStarterCode;
  label_de: string;
  label_en: string;
  category: VehicleEquipmentCategory;
}

export const VEHICLE_EQUIPMENT_STARTER_DEFINITIONS: VehicleEquipmentStarterDefinition[] =
  [
    {
      code: 'ABS',
      label_de: 'ABS',
      label_en: 'ABS',
      category: 'SAFETY',
    },
    {
      code: 'ESP',
      label_de: 'ESP',
      label_en: 'ESP',
      category: 'SAFETY',
    },
    {
      code: 'ISOFIX',
      label_de: 'ISOFIX',
      label_en: 'ISOFIX child seat anchors',
      category: 'SAFETY',
    },
    {
      code: 'AIR_CONDITIONING',
      label_de: 'Klimaanlage',
      label_en: 'Air conditioning',
      category: 'COMFORT',
    },
    {
      code: 'AUTOMATIC_CLIMATE',
      label_de: 'Klimaautomatik',
      label_en: 'Automatic climate control',
      category: 'COMFORT',
    },
    {
      code: 'SEAT_HEATING',
      label_de: 'Sitzheizung',
      label_en: 'Seat heating',
      category: 'COMFORT',
    },
    {
      code: 'CRUISE_CONTROL',
      label_de: 'Tempomat',
      label_en: 'Cruise control',
      category: 'COMFORT',
    },
    {
      code: 'BLUETOOTH',
      label_de: 'Bluetooth',
      label_en: 'Bluetooth',
      category: 'COMFORT',
    },
    {
      code: 'NAVIGATION',
      label_de: 'Navigationssystem',
      label_en: 'Navigation system',
      category: 'COMFORT',
    },
    {
      code: 'ALLOY_WHEELS',
      label_de: 'Leichtmetallfelgen',
      label_en: 'Alloy wheels',
      category: 'EXTERIOR',
    },
    {
      code: 'TOW_BAR',
      label_de: 'Anhängerkupplung',
      label_en: 'Tow bar',
      category: 'EXTERIOR',
    },
    {
      code: 'PARKING_FRONT',
      label_de: 'Einparkhilfe vorne',
      label_en: 'Front parking sensors',
      category: 'PARKING',
    },
    {
      code: 'PARKING_REAR',
      label_de: 'Einparkhilfe hinten',
      label_en: 'Rear parking sensors',
      category: 'PARKING',
    },
    {
      code: 'PARKING_CAMERA',
      label_de: 'Rückfahrkamera',
      label_en: 'Rear view camera',
      category: 'PARKING',
    },
  ];
