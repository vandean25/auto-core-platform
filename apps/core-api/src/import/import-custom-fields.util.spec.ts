import { CustomFieldType } from '@prisma/client';
import {
  extractCustomFieldMappings,
  mergeCustomFieldValuesForUpdate,
  parseAndValidateCustomFieldValues,
} from './import-custom-fields.util.js';
import type { CustomFieldDefinitionLike } from '../custom-fields/custom-fields.validation.js';

describe('import-custom-fields.util', () => {
  const defs: CustomFieldDefinitionLike[] = [
    { key: 'legacy_tier', type: CustomFieldType.TEXT, options: null, archived: false },
    { key: 'discount_pct', type: CustomFieldType.NUMBER, options: null, archived: false },
    { key: 'member_since', type: CustomFieldType.DATE, options: null, archived: false },
    { key: 'vip', type: CustomFieldType.BOOLEAN, options: null, archived: false },
    {
      key: 'segment',
      type: CustomFieldType.SELECT,
      options: ['A', 'B'],
      archived: false,
    },
  ];

  it('extracts only custom_fields.<key> entries with non-empty csvColumn', () => {
    expect(
      extractCustomFieldMappings({
        external_id: 'Kunden-Nr',
        'custom_fields.legacy_tier': 'Stufe',
        'custom_fields.empty': '  ',
        'custom_fields.': 'Ignored',
      }),
    ).toEqual([{ key: 'legacy_tier', csvColumn: 'Stufe' }]);
  });

  it('parses and validates TEXT, NUMBER (German), DATE (ISO & DE), BOOLEAN, and SELECT values', () => {
    const { values, issues } = parseAndValidateCustomFieldValues(
      {
        Stufe: 'Gold',
        Rabatt: '12,5',
        MitgliedSeit: '15.03.2020',
        VIP: 'ja',
        Segment: 'A',
      },
      [
        { key: 'legacy_tier', csvColumn: 'Stufe' },
        { key: 'discount_pct', csvColumn: 'Rabatt' },
        { key: 'member_since', csvColumn: 'MitgliedSeit' },
        { key: 'vip', csvColumn: 'VIP' },
        { key: 'segment', csvColumn: 'Segment' },
      ],
      new Map(defs.map((d) => [d.key, d])),
    );

    expect(issues).toEqual([]);
    expect(values).toEqual({
      legacy_tier: 'Gold',
      discount_pct: 12.5,
      member_since: '2020-03-15',
      vip: true,
      segment: 'A',
    });
  });

  it('reports per-field validation errors when values fail type checks and skips blank cells', () => {
    const { values, issues } = parseAndValidateCustomFieldValues(
      {
        Stufe: '',
        Rabatt: 'not-a-number',
        MitgliedSeit: '2026-02-30',
        VIP: 'maybe',
        Segment: 'Z',
      },
      [
        { key: 'legacy_tier', csvColumn: 'Stufe' },
        { key: 'discount_pct', csvColumn: 'Rabatt' },
        { key: 'member_since', csvColumn: 'MitgliedSeit' },
        { key: 'vip', csvColumn: 'VIP' },
        { key: 'segment', csvColumn: 'Segment' },
      ],
      new Map(defs.map((d) => [d.key, d])),
    );

    expect(values).toEqual({});
    expect(issues).toHaveLength(4);
    expect(issues.map((i) => i.field)).toEqual([
      'custom_fields.discount_pct',
      'custom_fields.member_since',
      'custom_fields.vip',
      'custom_fields.segment',
    ]);
    expect(issues.every((i) => i.code === 'CUSTOM_FIELD_VALUE_INVALID')).toBe(true);
  });

  it('merges custom_fields on update while respecting fill_empty_only', () => {
    const existing = { legacy_tier: 'Silver', untouched: 'keep' };
    expect(
      mergeCustomFieldValuesForUpdate(
        existing,
        { legacy_tier: 'Gold', vip: true },
        false,
      ),
    ).toEqual({ legacy_tier: 'Gold', untouched: 'keep', vip: true });

    expect(
      mergeCustomFieldValuesForUpdate(
        existing,
        { legacy_tier: 'Gold', vip: true },
        true,
      ),
    ).toEqual({ legacy_tier: 'Silver', untouched: 'keep', vip: true });
  });
});
