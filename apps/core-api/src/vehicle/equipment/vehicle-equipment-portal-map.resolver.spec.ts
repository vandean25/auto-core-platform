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
      assertion: 'PRESENT' as const,
    },
    {
      code: 'PARKING_CAMERA',
      label_de: 'Rückfahrkamera',
      label_en: 'Rear view camera',
      assertion: 'PRESENT' as const,
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

  it('emits explicit negative portal values only for confirmed absent options', () => {
    const resolved = resolveVehicleEquipmentForProfile('MOBILE_DE_REFERENCE_V1', {
      selections: [
        {
          code: 'ABS',
          label_de: 'ABS',
          label_en: 'ABS',
          assertion: 'ABSENT',
        },
      ],
      freeTextLines: [],
    });

    expect(resolved.mappedFields).toEqual([
      {
        localCode: 'ABS',
        portalField: '31',
        portalValue: '0',
        verification: 'UNVERIFIED',
      },
    ]);
    expect(resolved.equipmentFreeTextLines).toEqual([]);
  });

  it('appends confirmed absence as free text when the map has no portal negative', () => {
    const resolved = resolveVehicleEquipmentForProfile('MOBILE_DE_REFERENCE_V1', {
      selections: [
        {
          code: 'PARKING_CAMERA',
          label_de: 'Rückfahrkamera',
          label_en: 'Rear view camera',
          assertion: 'ABSENT',
        },
      ],
      freeTextLines: [],
    });

    expect(resolved.mappedFields).toEqual([]);
    expect(resolved.equipmentFreeTextLines).toEqual([
      'PARKING_CAMERA: Rückfahrkamera (not fitted)',
    ]);
  });

  it('appends confirmed absence as free text on provisional AutoScout24 profile', () => {
    const resolved = resolveVehicleEquipmentForProfile('AS24_PROVISIONAL_V1', {
      selections: [
        {
          code: 'ABS',
          label_de: 'ABS',
          label_en: 'ABS',
          assertion: 'ABSENT',
        },
      ],
      freeTextLines: [],
    });

    expect(resolved.equipmentCodes).toEqual([]);
    expect(resolved.mappedFields).toEqual([]);
    expect(resolved.equipmentFreeTextLines).toEqual(['ABS (not fitted)']);
  });

  it('exports local taxonomy codes for generic willhaben profile', () => {
    const resolved = resolveVehicleEquipmentForProfile('WILLHABEN_GENERIC_V1', {
      selections: [
        { code: 'ESP', label_de: 'ESP', label_en: 'ESP', assertion: 'PRESENT' },
      ],
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
