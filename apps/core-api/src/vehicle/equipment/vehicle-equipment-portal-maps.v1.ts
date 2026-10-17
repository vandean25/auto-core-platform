import type { EquipmentPortalMapDocument } from './vehicle-equipment-portal-map.types.js';

/**
 * Versioned per-portal equipment mappings (repository JSON contract).
 * mobile.de column indices are UNVERIFIED best-effort until AUT-569 pins the layout manifest.
 */
export const VEHICLE_EQUIPMENT_PORTAL_MAPS_V1: EquipmentPortalMapDocument = {
  version: '1',
  profiles: {
    MOBILE_DE_REFERENCE_V1: {
      verification: 'UNVERIFIED',
      source: 'https://services.mobile.de/manual/upload-interface-csv_de.html',
      version: '1',
      entries: [
        {
          local_code: 'ABS',
          profile: 'MOBILE_DE_REFERENCE_V1',
          portal_field: '31',
          portal_value: '1',
          absent_portal_value: '0',
          verification: 'UNVERIFIED',
          source:
            'https://services.mobile.de/manual/upload-interface-csv_de.html',
          version: '1',
        },
        {
          local_code: 'ESP',
          profile: 'MOBILE_DE_REFERENCE_V1',
          portal_field: '32',
          portal_value: '1',
          absent_portal_value: '0',
          verification: 'UNVERIFIED',
          source:
            'https://services.mobile.de/manual/upload-interface-csv_de.html',
          version: '1',
        },
        {
          local_code: 'AIR_CONDITIONING',
          profile: 'MOBILE_DE_REFERENCE_V1',
          portal_field: '33',
          portal_value: '1',
          absent_portal_value: '0',
          verification: 'UNVERIFIED',
          source:
            'https://services.mobile.de/manual/upload-interface-csv_de.html',
          version: '1',
        },
        {
          local_code: 'AUTOMATIC_CLIMATE',
          profile: 'MOBILE_DE_REFERENCE_V1',
          portal_field: '34',
          portal_value: '1',
          absent_portal_value: '0',
          verification: 'UNVERIFIED',
          source:
            'https://services.mobile.de/manual/upload-interface-csv_de.html',
          version: '1',
        },
        {
          local_code: 'NAVIGATION',
          profile: 'MOBILE_DE_REFERENCE_V1',
          portal_field: '35',
          portal_value: '1',
          absent_portal_value: '0',
          verification: 'UNVERIFIED',
          source:
            'https://services.mobile.de/manual/upload-interface-csv_de.html',
          version: '1',
        },
        {
          local_code: 'TOW_BAR',
          profile: 'MOBILE_DE_REFERENCE_V1',
          portal_field: '36',
          portal_value: '1',
          absent_portal_value: '0',
          verification: 'UNVERIFIED',
          source:
            'https://services.mobile.de/manual/upload-interface-csv_de.html',
          version: '1',
        },
        {
          local_code: 'PARKING_REAR',
          profile: 'MOBILE_DE_REFERENCE_V1',
          portal_field: '37',
          portal_value: '1',
          absent_portal_value: '0',
          verification: 'UNVERIFIED',
          source:
            'https://services.mobile.de/manual/upload-interface-csv_de.html',
          version: '1',
        },
      ],
    },
    AS24_PROVISIONAL_V1: {
      verification: 'UNVERIFIED',
      source: 'https://www.autoscout24.at/partner-infoportal/faq/',
      version: '1',
      export_local_codes: true,
      entries: [],
    },
    WILLHABEN_GENERIC_V1: {
      verification: 'UNVERIFIED',
      source: 'https://fahrzeughandel.willhaben.at/produktpakete/',
      version: '1',
      export_local_codes: true,
      entries: [],
    },
  },
};
