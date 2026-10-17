import { getEquipmentPortalProfileConfig } from './vehicle-equipment-portal-map.registry.js';
import type {
  EquipmentListingSerializerProfile,
  EquipmentPortalMapEntry,
  ResolvedVehicleEquipmentExport,
  VehicleEquipmentSelectionInput,
} from './vehicle-equipment-portal-map.types.js';
import { VEHICLE_EQUIPMENT_PORTAL_MAPS_V1 } from './vehicle-equipment-portal-maps.v1.js';

const EQUIPMENT_FREE_TEXT_LABEL = 'Ausstattung';

function formatUnmappedLine(selection: VehicleEquipmentSelectionInput): string {
  const label = selection.label_de.trim() || selection.label_en.trim();
  if (label && label !== selection.code) {
    return `${selection.code}: ${label}`;
  }
  return selection.code;
}

function indexEntriesByLocalCode(
  entries: EquipmentPortalMapEntry[],
): Map<string, EquipmentPortalMapEntry> {
  const map = new Map<string, EquipmentPortalMapEntry>();
  for (const entry of entries) {
    map.set(entry.local_code, entry);
  }
  return map;
}

/**
 * Resolves vehicle equipment selections and free-text lines for a listing serializer profile.
 * Unknown codes and unmapped taxonomy items are never dropped — they are returned as free text.
 */
export function resolveVehicleEquipmentForProfile(
  profile: EquipmentListingSerializerProfile,
  input: {
    selections: VehicleEquipmentSelectionInput[];
    freeTextLines: string[];
    passThroughFreeText?: string[];
  },
  mappingVersion = VEHICLE_EQUIPMENT_PORTAL_MAPS_V1.version,
): ResolvedVehicleEquipmentExport {
  const profileConfig = getEquipmentPortalProfileConfig(
    profile,
    mappingVersion,
  );
  const entryByCode = indexEntriesByLocalCode(profileConfig.entries);

  const mappedFields: ResolvedVehicleEquipmentExport['mappedFields'] = [];
  const equipmentCodes: string[] = [];
  const equipmentFreeTextLines: string[] = [];

  const sortedSelections = [...input.selections].sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  for (const selection of sortedSelections) {
    if (selection.assertion === 'ABSENT') {
      continue;
    }

    const entry = entryByCode.get(selection.code);
    if (profileConfig.export_local_codes) {
      equipmentCodes.push(selection.code);
      continue;
    }
    if (entry) {
      mappedFields.push({
        localCode: selection.code,
        portalField: entry.portal_field,
        portalValue: entry.portal_value,
        verification: entry.verification,
      });
      continue;
    }
    equipmentFreeTextLines.push(formatUnmappedLine(selection));
  }

  for (const line of input.freeTextLines) {
    const trimmed = line.trim();
    if (trimmed) {
      equipmentFreeTextLines.push(trimmed);
    }
  }

  for (const line of input.passThroughFreeText ?? []) {
    const trimmed = line.trim();
    if (trimmed) {
      equipmentFreeTextLines.push(trimmed);
    }
  }

  return {
    profile,
    mappingVersion,
    profileVerification: profileConfig.verification,
    mappedFields,
    equipmentCodes,
    equipmentFreeTextLines,
  };
}

/** Plain-text equipment appendix for listing descriptions (spec: labelled paragraph). */
export function buildEquipmentFreeTextParagraph(
  lines: string[],
  label = EQUIPMENT_FREE_TEXT_LABEL,
): string {
  if (lines.length === 0) {
    return '';
  }
  return `${label}: ${lines.join('; ')}`;
}
