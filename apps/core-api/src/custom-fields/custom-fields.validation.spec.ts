import { UnprocessableEntityException } from '@nestjs/common';
import { CustomFieldType } from '@prisma/client';
import {
  MAX_CUSTOM_FIELD_SELECT_OPTIONS,
  MAX_CUSTOM_FIELD_TEXT_LENGTH,
} from './custom-fields.constants.js';
import {
  filterVisibleCustomFieldValues,
  normalizeCustomFieldKey,
  validateAndMergeCustomFieldValues,
  validateSelectOptions,
} from './custom-fields.validation.js';

describe('custom-fields.validation', () => {
  const definitions = [
    {
      key: 'flottennummer',
      type: CustomFieldType.TEXT,
      options: null,
      archived: false,
    },
    {
      key: 'fahrzeuganzahl',
      type: CustomFieldType.NUMBER,
      options: null,
      archived: false,
    },
    {
      key: 'naechster_kontakt',
      type: CustomFieldType.DATE,
      options: null,
      archived: false,
    },
    {
      key: 'vip_kunde',
      type: CustomFieldType.BOOLEAN,
      options: null,
      archived: false,
    },
    {
      key: 'kontaktweg',
      type: CustomFieldType.SELECT,
      options: ['Telefon', 'E-Mail'],
      archived: false,
    },
    {
      key: 'alt_feld',
      type: CustomFieldType.TEXT,
      options: null,
      archived: true,
    },
  ];

  it('normalizes and validates slug keys', () => {
    expect(normalizeCustomFieldKey('Flotten Nummer-1')).toBe('flotten_nummer_1');
    expect(() => normalizeCustomFieldKey('123invalid')).toThrow(
      UnprocessableEntityException,
    );
  });

  it('validates SELECT options and rejects > 50 options', () => {
    expect(validateSelectOptions(CustomFieldType.SELECT, ['A', 'B'])).toEqual([
      'A',
      'B',
    ]);
    expect(() =>
      validateSelectOptions(CustomFieldType.SELECT, []),
    ).toThrow(UnprocessableEntityException);

    const tooMany = Array.from(
      { length: MAX_CUSTOM_FIELD_SELECT_OPTIONS + 1 },
      (_, i) => `Opt ${i}`,
    );
    expect(() =>
      validateSelectOptions(CustomFieldType.SELECT, tooMany),
    ).toThrow(UnprocessableEntityException);
  });

  it('merges valid values of all 5 types and clears null keys', () => {
    const merged = validateAndMergeCustomFieldValues(
      definitions,
      { flottennummer: 'OLD', vip_kunde: true },
      {
        flottennummer: 'FL-100',
        fahrzeuganzahl: 5,
        naechster_kontakt: '2026-12-01',
        vip_kunde: null,
        kontaktweg: 'E-Mail',
      },
    );
    expect(merged).toEqual({
      flottennummer: 'FL-100',
      fahrzeuganzahl: 5,
      naechster_kontakt: '2026-12-01',
      kontaktweg: 'E-Mail',
    });
  });

  it('rejects TEXT exceeding max length with 422', () => {
    expect(() =>
      validateAndMergeCustomFieldValues(
        definitions,
        {},
        { flottennummer: 'a'.repeat(MAX_CUSTOM_FIELD_TEXT_LENGTH + 1) },
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects invalid SELECT option, NUMBER, DATE, BOOLEAN, unknown, and archived keys with 422', () => {
    expect(() =>
      validateAndMergeCustomFieldValues(definitions, {}, { kontaktweg: 'Fax' }),
    ).toThrow(UnprocessableEntityException);

    expect(() =>
      validateAndMergeCustomFieldValues(definitions, {}, { fahrzeuganzahl: 'five' }),
    ).toThrow(UnprocessableEntityException);

    expect(() =>
      validateAndMergeCustomFieldValues(definitions, {}, { naechster_kontakt: '2026-02-30' }),
    ).toThrow(UnprocessableEntityException);

    expect(() =>
      validateAndMergeCustomFieldValues(definitions, {}, { vip_kunde: 'yes' }),
    ).toThrow(UnprocessableEntityException);

    expect(() =>
      validateAndMergeCustomFieldValues(definitions, {}, { unknown_key: 'x' }),
    ).toThrow(UnprocessableEntityException);

    expect(() =>
      validateAndMergeCustomFieldValues(definitions, {}, { alt_feld: 'x' }),
    ).toThrow(UnprocessableEntityException);
  });

  it('filters out archived keys from visible custom_fields while keeping active ones', () => {
    const visible = filterVisibleCustomFieldValues(
      { flottennummer: 'FL-1', alt_feld: 'secret' },
      definitions.filter((d) => !d.archived),
    );
    expect(visible).toEqual({ flottennummer: 'FL-1' });
  });
});
