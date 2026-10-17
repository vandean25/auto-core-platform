import {
  buildEquipmentFreeTextParagraph,
  resolveVehicleEquipmentForProfile,
} from './vehicle-equipment-portal-map.resolver.js';

describe('resolveVehicleEquipmentForProfile', () => {
  const baseSelections = [
    {
      code: 'ABS',
      label_de: 'ABS',
      label_en: 'ABS',
    },
    {
      code: 'PARKING_CAMERA',
      label_de: 'Rückfahrkamera',
      label_en: 'Rear view camera',
    },
  ];

  it('maps known mobile.de codes to portal fields and keeps unmapped codes as free text', () => {
    const resolved = resolveVehicleEquipmentForProfile('MOBILE_DE_REFERENCE_V1', {
      selections: baseSelections,
      freeTextLines: ['Panoramic roof'],
    });

    expect(resolved.mappedFields).toEqual([
      {
        localCode: 'ABS',
        portalField: '31',
        portalValue: '1',
        verification: 'UNVERIFIED',
      },
    ]);
    expect(resolved.equipmentCodes).toEqual([]);
    expect(resolved.equipmentFreeTextLines).toEqual([
      'PARKING_CAMERA: Rückfahrkamera',
      'Panoramic roof',
    ]);
    expect(resolved.profileVerification).toBe('UNVERIFIED');
  });

  it('exports local taxonomy codes for provisional AutoScout24 profile', () => {
    const resolved = resolveVehicleEquipmentForProfile('AS24_PROVISIONAL_V1', {
      selections: baseSelections,
      freeTextLines: [],
    });

    expect(resolved.equipmentCodes).toEqual(['ABS', 'PARKING_CAMERA']);
    expect(resolved.mappedFields).toEqual([]);
    expect(resolved.equipmentFreeTextLines).toEqual([]);
  });

  it('exports local taxonomy codes for generic willhaben profile', () => {
    const resolved = resolveVehicleEquipmentForProfile('WILLHABEN_GENERIC_V1', {
      selections: [{ code: 'ESP', label_de: 'ESP', label_en: 'ESP' }],
      freeTextLines: ['Custom line'],
      passThroughFreeText: ['UNKNOWN_OPTION'],
    });

    expect(resolved.equipmentCodes).toEqual(['ESP']);
    expect(resolved.equipmentFreeTextLines).toEqual([
      'Custom line',
      'UNKNOWN_OPTION',
    ]);
  });

  it('never drops unknown pass-through values', () => {
    const resolved = resolveVehicleEquipmentForProfile('MOBILE_DE_REFERENCE_V1', {
      selections: [],
      freeTextLines: [],
      passThroughFreeText: ['  Sunroof  ', ''],
    });

    expect(resolved.equipmentFreeTextLines).toEqual(['Sunroof']);
  });
});

describe('buildEquipmentFreeTextParagraph', () => {
  it('formats a labelled equipment paragraph', () => {
    expect(
      buildEquipmentFreeTextParagraph(['Line A', 'Line B']),
    ).toBe('Ausstattung: Line A; Line B');
  });

  it('returns empty string when there are no lines', () => {
    expect(buildEquipmentFreeTextParagraph([])).toBe('');
  });
});
