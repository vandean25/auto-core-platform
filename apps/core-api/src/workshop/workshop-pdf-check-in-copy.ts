import type { DisplayLanguage } from '@prisma/client';

export type WorkshopCheckInPdfCopy = {
  sectionTitle: string;
  conditionTitle: string;
  tyreSeasonLabel: string;
  exteriorNotesLabel: string;
  interiorNotesLabel: string;
  belongingsTitle: string;
  itemsLeftLabel: string;
  keyCountLabel: string;
  odometerLabel: string;
  fuelLevelLabel: string;
  warningLightsLabel: string;
  damageMarkersTitle: string;
  photosTitle: string;
  checklistTitle: string;
  checklistItemHeader: string;
  checklistStatusHeader: string;
  checklistNotesHeader: string;
  checklistPassedLabel: string;
  checklistFailedLabel: string;
  checklistOpenLabel: string;
  signatureTitle: string;
  signedByLabel: string;
  signedAtLabel: string;
  acknowledgementLabel: string;
  zoneLabel: (zoneId: string) => string;
  damageTypeLabel: (type: string) => string;
  tyreSeasonLabelValue: (season: string) => string;
};

const ZONE_LABELS_DE: Record<string, string> = {
  FRONT_BUMPER: 'Frontstoßstange',
  BONNET: 'Motorhaube',
  WINDSCREEN: 'Frontscheibe',
  ROOF: 'Dach',
  REAR_WINDOW: 'Heckscheibe',
  BOOT: 'Kofferraumdeckel',
  REAR_BUMPER: 'Heckstoßstange',
  LEFT_FRONT_WING: 'Linker Kotflügel vorn',
  LEFT_FRONT_DOOR: 'Linke Tür vorn',
  LEFT_REAR_DOOR: 'Linke Tür hinten',
  LEFT_REAR_WING: 'Linker Kotflügel hinten',
  RIGHT_FRONT_WING: 'Rechter Kotflügel vorn',
  RIGHT_FRONT_DOOR: 'Rechte Tür vorn',
  RIGHT_REAR_DOOR: 'Rechte Tür hinten',
  RIGHT_REAR_WING: 'Rechter Kotflügel hinten',
  LEFT_FRONT_WHEEL: 'Linkes Rad vorn',
  LEFT_REAR_WHEEL: 'Linkes Rad hinten',
  RIGHT_FRONT_WHEEL: 'Rechtes Rad vorn',
  RIGHT_REAR_WHEEL: 'Rechtes Rad hinten',
  OTHER: 'Sonstiges',
};

const ZONE_LABELS_EN: Record<string, string> = {
  FRONT_BUMPER: 'Front bumper',
  BONNET: 'Bonnet',
  WINDSCREEN: 'Windscreen',
  ROOF: 'Roof',
  REAR_WINDOW: 'Rear window',
  BOOT: 'Boot lid',
  REAR_BUMPER: 'Rear bumper',
  LEFT_FRONT_WING: 'Left front wing',
  LEFT_FRONT_DOOR: 'Left front door',
  LEFT_REAR_DOOR: 'Left rear door',
  LEFT_REAR_WING: 'Left rear wing',
  RIGHT_FRONT_WING: 'Right front wing',
  RIGHT_FRONT_DOOR: 'Right front door',
  RIGHT_REAR_DOOR: 'Right rear door',
  RIGHT_REAR_WING: 'Right rear wing',
  LEFT_FRONT_WHEEL: 'Left front wheel',
  LEFT_REAR_WHEEL: 'Left rear wheel',
  RIGHT_FRONT_WHEEL: 'Right front wheel',
  RIGHT_REAR_WHEEL: 'Right rear wheel',
  OTHER: 'Other',
};

const DAMAGE_TYPE_LABELS_DE: Record<string, string> = {
  SCRATCH: 'Kratzer',
  DENT: 'Delle',
  CRACK: 'Riss',
  OTHER: 'Sonstiges',
};

const DAMAGE_TYPE_LABELS_EN: Record<string, string> = {
  SCRATCH: 'Scratch',
  DENT: 'Dent',
  CRACK: 'Crack',
  OTHER: 'Other',
};

const TYRE_SEASON_LABELS_DE: Record<string, string> = {
  SUMMER: 'Sommer',
  WINTER: 'Winter',
  ALL_SEASON: 'Ganzjahres',
  UNKNOWN: 'Unbekannt',
};

const TYRE_SEASON_LABELS_EN: Record<string, string> = {
  SUMMER: 'Summer',
  WINTER: 'Winter',
  ALL_SEASON: 'All-season',
  UNKNOWN: 'Unknown',
};

function labelFromMap(
  map: Record<string, string>,
  key: string,
  fallback: string,
): string {
  return map[key] ?? fallback;
}

const WORKSHOP_CHECK_IN_PDF_COPY: Record<
  DisplayLanguage,
  WorkshopCheckInPdfCopy
> = {
  de: {
    sectionTitle: 'Fahrzeugannahme',
    conditionTitle: 'Zustand',
    tyreSeasonLabel: 'Bereifung',
    exteriorNotesLabel: 'Außen',
    interiorNotesLabel: 'Innen',
    belongingsTitle: 'Übergabe',
    itemsLeftLabel: 'Gegenstände im Fahrzeug',
    keyCountLabel: 'Schlüsselanzahl',
    odometerLabel: 'Kilometerstand',
    fuelLevelLabel: 'Tankfüllung',
    warningLightsLabel: 'Warnleuchten',
    damageMarkersTitle: 'Schäden',
    photosTitle: 'Fotos',
    checklistTitle: 'Annahme-Checkliste',
    checklistItemHeader: 'Punkt',
    checklistStatusHeader: 'Status',
    checklistNotesHeader: 'Notiz',
    checklistPassedLabel: 'OK',
    checklistFailedLabel: 'Nicht OK',
    checklistOpenLabel: 'Offen',
    signatureTitle: 'Kundenbestätigung',
    signedByLabel: 'Name',
    signedAtLabel: 'Zeitpunkt',
    acknowledgementLabel: 'Bestätigungstext',
    zoneLabel: (zoneId) =>
      labelFromMap(ZONE_LABELS_DE, zoneId, zoneId.replaceAll('_', ' ')),
    damageTypeLabel: (type) => labelFromMap(DAMAGE_TYPE_LABELS_DE, type, type),
    tyreSeasonLabelValue: (season) =>
      labelFromMap(TYRE_SEASON_LABELS_DE, season, season),
  },
  en: {
    sectionTitle: 'Vehicle check-in',
    conditionTitle: 'Condition',
    tyreSeasonLabel: 'Tyres',
    exteriorNotesLabel: 'Exterior',
    interiorNotesLabel: 'Interior',
    belongingsTitle: 'Handover',
    itemsLeftLabel: 'Items in vehicle',
    keyCountLabel: 'Number of keys',
    odometerLabel: 'Odometer',
    fuelLevelLabel: 'Fuel level',
    warningLightsLabel: 'Warning lights',
    damageMarkersTitle: 'Damage markers',
    photosTitle: 'Photos',
    checklistTitle: 'Check-in checklist',
    checklistItemHeader: 'Item',
    checklistStatusHeader: 'Status',
    checklistNotesHeader: 'Notes',
    checklistPassedLabel: 'OK',
    checklistFailedLabel: 'Not OK',
    checklistOpenLabel: 'Open',
    signatureTitle: 'Customer acknowledgement',
    signedByLabel: 'Name',
    signedAtLabel: 'Signed at',
    acknowledgementLabel: 'Acknowledgement',
    zoneLabel: (zoneId) =>
      labelFromMap(ZONE_LABELS_EN, zoneId, zoneId.replaceAll('_', ' ')),
    damageTypeLabel: (type) => labelFromMap(DAMAGE_TYPE_LABELS_EN, type, type),
    tyreSeasonLabelValue: (season) =>
      labelFromMap(TYRE_SEASON_LABELS_EN, season, season),
  },
};

export function getWorkshopCheckInPdfCopy(
  documentLocale: DisplayLanguage,
): WorkshopCheckInPdfCopy {
  return WORKSHOP_CHECK_IN_PDF_COPY[documentLocale];
}
